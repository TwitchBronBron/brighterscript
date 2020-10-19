import * as path from 'path';
import { SourceNode } from 'source-map';
import { CompletionItem, CompletionItemKind, Location, Hover, Position, Range, DocumentSymbol, SymbolKind, SymbolInformation, SignatureInformation, ParameterInformation } from 'vscode-languageserver';
import chalk from 'chalk';
import { Scope } from '../Scope';
import { diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, CallableArg, CallableParam, CommentFlag, FunctionCall, BsDiagnostic, FileReference } from '../interfaces';
import { Deferred } from '../deferred';
import { Lexer, Token, TokenKind, Identifier, AllowedLocalIdentifiers, Keywords } from '../lexer';
import { Parser, ParseMode, Statement, FunctionStatement, NamespaceStatement } from '../parser';
import { FunctionExpression, VariableExpression, Expression } from '../parser/Expression';
import { AssignmentStatement, ClassStatement, LibraryStatement, ImportStatement } from '../parser/Statement';
import { Program } from '../Program';
import { BrsType } from '../types/BrsType';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { VoidType } from '../types/VoidType';
import { standardizePath as s, util } from '../util';
import { TranspileState } from '../parser/TranspileState';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';
import { isAALiteralExpression, isAssignmentStatement, isCallExpression, isClassStatement, isCommentStatement, isDottedGetExpression, isFunctionExpression, isFunctionParameterExpression, isFunctionStatement, isFunctionType, isIfStatement, isImportStatement, isLibraryStatement, isLiteralExpression, isStringType, isVariableExpression } from '../astUtils/reflection';
import { WalkMode } from '../astUtils';
import { createVisitor } from '../astUtils/visitors';

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile {
    constructor(
        public pathAbsolute: string,
        /**
         * The full pkg path to this file
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.pathAbsolute = s`${this.pathAbsolute}`;
        this.pkgPath = s`${this.pkgPath}`;
        this.dependencyGraphKey = this.pkgPath.toLowerCase();

        this.extension = path.extname(pathAbsolute).toLowerCase();

        //all BrighterScript files need to be transpiled
        if (this.extension === '.bs') {
            this.needsTranspiled = true;
        }
    }

    /**
     * The key used to identify this file in the dependency graph
     */
    public dependencyGraphKey: string;
    /**
     * The extension for this file
     */
    public extension: string;

    private parseDeferred = new Deferred();

    /**
     * Indicates that the file is completely ready for interaction
     */
    public isReady() {
        return this.parseDeferred.promise;
    }

    private diagnostics = [] as BsDiagnostic[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    public commentFlags = [] as CommentFlag[];

    public callables = [] as Callable[];

    public functionCalls = [] as FunctionCall[];

    private _functionScopes: FunctionScope[];

    public get functionScopes(): FunctionScope[] {
        if (!this._functionScopes) {
            this.createFunctionScopes();
        }
        return this._functionScopes;
    }

    /**
     * files referenced by import statements
     */
    public ownScriptImports = [] as FileReference[];

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    /**
     * The AST for this file
     */
    public get ast() {
        return this.parser.ast;
    }

    private documentSymbols: DocumentSymbol[];

    private workspaceSymbols: SymbolInformation[];

    /**
     * Get the token at the specified position
     * @param position
     */
    private getTokenAt(position: Position) {
        for (let token of this.parser.tokens) {
            if (util.rangeContains(token.range, position)) {
                return token;
            }
        }
    }


    public parser: Parser;

    public fileContents: string;

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public parse(fileContents: string) {
        try {
            this.fileContents = fileContents;
            if (this.parseDeferred.isCompleted) {
                throw new Error(`File was already processed. Create a new instance of BrsFile instead. ${this.pathAbsolute}`);
            }

            //tokenize the input file
            let lexer = this.program.logger.time(LogLevel.debug, ['lexer.lex', chalk.green(this.pathAbsolute)], () => {
                return Lexer.scan(fileContents, {
                    includeWhitespace: false
                });
            });

            this.getIgnores(lexer.tokens);

            let preprocessor = new Preprocessor();

            //remove all code inside false-resolved conditional compilation statements.
            //TODO preprocessor should go away in favor of the AST handling this internally (because it affects transpile)
            //currently the preprocessor throws exceptions on syntax errors...so we need to catch it
            try {
                this.program.logger.time(LogLevel.debug, ['preprocessor.process', chalk.green(this.pathAbsolute)], () => {
                    preprocessor.process(lexer.tokens, this.program.getManifest());
                });
            } catch (error) {
                //if the thrown error is DIFFERENT than any errors from the preprocessor, add that error to the list as well
                if (this.diagnostics.find((x) => x === error) === undefined) {
                    this.diagnostics.push(error);
                }
            }

            //if the preprocessor generated tokens, use them.
            let tokens = preprocessor.processedTokens.length > 0 ? preprocessor.processedTokens : lexer.tokens;

            this.parser = new Parser();
            this.program.logger.time(LogLevel.debug, ['parser.parse', chalk.green(this.pathAbsolute)], () => {
                this.parser.parse(tokens, {
                    mode: this.extension === '.brs' ? ParseMode.BrightScript : ParseMode.BrighterScript,
                    logger: this.program.logger
                });
            });

            //absorb all lexing/preprocessing/parsing diagnostics
            this.diagnostics.push(
                ...lexer.diagnostics as BsDiagnostic[],
                ...preprocessor.diagnostics as BsDiagnostic[],
                ...this.parser.diagnostics as BsDiagnostic[]
            );

            //notify AST ready
            this.program.plugins.emit('afterFileParse', this);

            //extract all callables from this file
            this.findCallables();

            //find all places where a sub/function is being called
            this.findFunctionCalls();

            this.findAndValidateImportAndImportStatements();

            //attach this file to every diagnostic
            for (let diagnostic of this.diagnostics) {
                diagnostic.file = this;
            }
        } catch (e) {
            this.parser = new Parser();
            this.diagnostics.push({
                file: this,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE),
                ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(serializeError(e)))
            });
        }
        this.parseDeferred.resolve();
    }

    public findAndValidateImportAndImportStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement>;

        for (let stmt of this.ast.statements) {
            //skip comments
            if (isCommentStatement(stmt)) {
                continue;
            }
            //if we found a non-library statement, this statement is not at the top of the file
            if (isLibraryStatement(stmt) || isImportStatement(stmt)) {
                topOfFileIncludeStatements.push(stmt);
            } else {
                //break out of the loop, we found all of our library statements
                break;
            }
        }

        let statements = [
            ...this.parser.references.libraryStatements,
            ...this.parser.references.importStatements
        ];
        for (let result of statements) {
            //register import statements
            if (isImportStatement(result) && result.filePathToken) {
                this.ownScriptImports.push({
                    filePathRange: result.filePathToken.range,
                    pkgPath: util.getPkgPathFromTarget(this.pkgPath, result.filePath),
                    sourceFile: this,
                    text: result.filePathToken?.text
                });
            }

            //if this statement is not one of the top-of-file statements,
            //then add a diagnostic explaining that it is invalid
            if (!topOfFileIncludeStatements.includes(result)) {
                if (isLibraryStatement(result)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this
                    });
                } else if (isImportStatement(result)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.importStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this
                    });
                }
            }
        }
    }

    /**
     * Find a class by its full namespace-prefixed name.
     * Returns undefined if not found.
     * @param namespaceName - the namespace to resolve relative classes from.
     */
    public getClassByName(className: string, namespaceName?: string) {
        let scopes = this.program.getScopesForFile(this);
        let lowerClassName = className.toLowerCase();

        //if the class is namespace-prefixed, look only for this exact name
        if (className.includes('.')) {
            for (let scope of scopes) {
                let cls = scope.classLookup[lowerClassName];
                if (cls) {
                    return cls;
                }
            }

            //we have a class name without a namespace prefix.
        } else {
            let globalClass: ClassStatement;
            let namespacedClass: ClassStatement;
            for (let scope of scopes) {
                //get the global class if it exists
                let possibleGlobalClass = scope.classLookup[lowerClassName];
                if (possibleGlobalClass && !globalClass) {
                    globalClass = possibleGlobalClass;
                }
                if (namespaceName) {
                    let possibleNamespacedClass = scope.classLookup[namespaceName.toLowerCase() + '.' + lowerClassName];
                    if (possibleNamespacedClass) {
                        namespacedClass = possibleNamespacedClass;
                        break;
                    }
                }

            }

            if (namespacedClass) {
                return namespacedClass;
            } else if (globalClass) {
                return globalClass;
            }
        }
    }

    public findPropertyNameCompletions() {
        //Find every identifier in the whole file
        let identifiers = util.findAllDeep<Identifier>(this.ast.statements, (x) => {
            return x && x.kind === TokenKind.Identifier;
        });

        this._propertyNameCompletions = [];
        let names = {};
        for (let identifier of identifiers) {
            let ancestors = this.getAncestors(identifier.key);
            let parent = ancestors[ancestors.length - 1];

            let isObjectProperty = !!ancestors.find(x => (isDottedGetExpression(x)) || (isAALiteralExpression(x)));

            //filter out certain text items
            if (
                //don't filter out any object properties
                isObjectProperty === false && (
                    //top-level functions (they are handled elsewhere)
                    isFunctionStatement(parent) ||
                    //local variables created or used by assignments
                    isAssignmentStatement(ancestors.find(x => x)) ||
                    //local variables used in conditional statements
                    isIfStatement(ancestors.find(x => x)) ||
                    //the 'as' keyword (and parameter types) when used in a type statement
                    ancestors.find(x => isFunctionParameterExpression(x))
                )
            ) {
                continue;
            }

            let name = identifier.value.text;

            //filter duplicate names
            if (names[name]) {
                continue;
            }

            names[name] = true;
            this._propertyNameCompletions.push({
                label: name,
                kind: CompletionItemKind.Text
            });
        }
    }

    private _propertyNameCompletions: CompletionItem[];

    public get propertyNameCompletions(): CompletionItem[] {
        if (!this._propertyNameCompletions) {
            this.findPropertyNameCompletions();
        }
        return this._propertyNameCompletions;
    }

    /**
     * Find all comment flags in the source code. These enable or disable diagnostic messages.
     * @param lines - the lines of the program
     */
    public getIgnores(tokens: Token[]) {
        //TODO use the comment statements found in the AST for this instead of text search
        let allCodesExcept1014 = diagnosticCodes.filter((x) => x !== DiagnosticMessages.unknownDiagnosticCode(0).code);
        this.commentFlags = [];
        for (let token of tokens) {
            let tokenized = util.tokenizeBsDisableComment(token);
            if (!tokenized) {
                continue;
            }

            let affectedRange: Range;
            if (tokenized.disableType === 'line') {
                affectedRange = util.createRange(token.range.start.line, 0, token.range.start.line, token.range.start.character);
            } else if (tokenized.disableType === 'next-line') {
                affectedRange = util.createRange(token.range.start.line + 1, 0, token.range.start.line + 1, Number.MAX_SAFE_INTEGER);
            }

            let commentFlag: CommentFlag;

            //statement to disable EVERYTHING
            if (tokenized.codes.length === 0) {
                commentFlag = {
                    file: this,
                    //null means all codes
                    codes: null,
                    range: token.range,
                    affectedRange: affectedRange
                };

                //disable specific diagnostic codes
            } else {
                let codes = [] as number[];
                for (let codeToken of tokenized.codes) {
                    let codeInt = parseInt(codeToken.code);
                    //add a warning for unknown codes
                    if (diagnosticCodes.includes(codeInt)) {
                        codes.push(codeInt);
                    } else {
                        this.diagnostics.push({
                            ...DiagnosticMessages.unknownDiagnosticCode(codeInt),
                            file: this,
                            range: codeToken.range
                        });
                    }
                }
                if (codes.length > 0) {
                    commentFlag = {
                        file: this,
                        codes: codes,
                        range: token.range,
                        affectedRange: affectedRange
                    };
                }
            }

            if (commentFlag) {
                this.commentFlags.push(commentFlag);

                //add an ignore for everything in this comment except for Unknown_diagnostic_code_1014
                this.commentFlags.push({
                    affectedRange: commentFlag.range,
                    range: commentFlag.range,
                    codes: allCodesExcept1014,
                    file: this
                });
            }
        }
    }

    public scopesByFunc = new Map<FunctionExpression, FunctionScope>();

    /**
     * Create a scope for every function in this file
     */
    private createFunctionScopes() {
        //find every function
        let functions = this.parser.references.functionExpressions;

        //create a functionScope for every function
        this._functionScopes = [];

        for (let func of functions) {
            let scope = new FunctionScope(func);

            //find parent function, and add this scope to it if found
            {
                let parentScope = this.scopesByFunc.get(func.parentFunction);

                //add this child scope to its parent
                if (parentScope) {
                    parentScope.childrenScopes.push(scope);
                }
                //store the parent scope for this scope
                scope.parentScope = parentScope;
            }

            //add every parameter
            for (let param of func.parameters) {
                scope.variableDeclarations.push({
                    nameRange: param.name.range,
                    lineIndex: param.name.range.start.line,
                    name: param.name.text,
                    type: util.valueKindToBrsType(param.type.kind)
                });
            }

            this.scopesByFunc.set(func, scope);

            //find every statement in the scope
            this._functionScopes.push(scope);
        }

        //find every variable assignment in the whole file
        let assignmentStatements = this.parser.references.assignmentStatements;

        for (let statement of assignmentStatements) {

            //find this statement's function scope
            let scope = this.scopesByFunc.get(statement.containingFunction);

            //skip variable declarations that are outside of any scope
            if (scope) {
                scope.variableDeclarations.push({
                    nameRange: statement.name.range,
                    lineIndex: statement.name.range.start.line,
                    name: statement.name.text,
                    type: this.getBRSTypeFromAssignment(statement, scope)
                });
            }
        }
    }

    /**
     * Get all ancestors of an object with the given key
     * @param statements
     * @param key
     */
    private getAncestors(key: string) {
        let parts = key.split('.');
        //throw out the last part (because that's the "child")
        parts.pop();

        let current = this.ast.statements;
        let ancestors = [];
        for (let part of parts) {
            current = current[part];
            ancestors.push(current);
        }
        return ancestors;
    }

    private getBRSTypeFromAssignment(assignment: AssignmentStatement, scope: FunctionScope): BrsType {
        try {
            //function
            if (isFunctionExpression(assignment.value)) {
                let functionType = new FunctionType(util.valueKindToBrsType(assignment.value.returns));
                functionType.isSub = assignment.value.functionType.text === 'sub';
                if (functionType.isSub) {
                    functionType.returnType = new VoidType();
                }

                functionType.setName(assignment.name.text);
                for (let argument of assignment.value.parameters) {
                    let isRequired = !argument.defaultValue;
                    //TODO compute optional parameters
                    functionType.addParameter(argument.name.text, util.valueKindToBrsType(argument.type.kind), isRequired);
                }
                return functionType;

                //literal
            } else if (isLiteralExpression(assignment.value)) {
                return util.valueKindToBrsType((assignment.value as any).value.kind);

                //function call
            } else if (isCallExpression(assignment.value)) {
                let calleeName = (assignment.value.callee as any).name.text;
                if (calleeName) {
                    let func = this.getCallableByName(calleeName);
                    if (func) {
                        return func.type.returnType;
                    }
                }
            } else if (isVariableExpression(assignment.value)) {
                let variableName = assignment.value.name.text;
                let variable = scope.getVariableByName(variableName);
                return variable.type;
            }
        } catch (e) {
            //do nothing. Just return dynamic
        }
        //fallback to dynamic
        return new DynamicType();
    }

    private getCallableByName(name: string) {
        name = name ? name.toLowerCase() : undefined;
        if (!name) {
            return;
        }
        for (let func of this.callables) {
            if (func.name.toLowerCase() === name) {
                return func;
            }
        }
    }

    private findCallables() {
        for (let statement of this.parser.references.functionStatements ?? []) {

            let functionType = new FunctionType(util.valueKindToBrsType(statement.func.returns));
            functionType.setName(statement.name.text);
            functionType.isSub = statement.func.functionType.text.toLowerCase() === 'sub';
            if (functionType.isSub) {
                functionType.returnType = new VoidType();
            }

            //extract the parameters
            let params = [] as CallableParam[];
            for (let param of statement.func.parameters) {
                let callableParam = {
                    name: param.name.text,
                    type: util.valueKindToBrsType(param.type.kind),
                    isOptional: !!param.defaultValue,
                    isRestArgument: false
                };
                params.push(callableParam);
                let isRequired = !param.defaultValue;
                functionType.addParameter(callableParam.name, callableParam.type, isRequired);
            }

            this.callables.push({
                isSub: statement.func.functionType.text.toLowerCase() === 'sub',
                name: statement.name.text,
                nameRange: statement.name.range,
                file: this,
                params: params,
                range: statement.func.range,
                type: functionType,
                getName: statement.getName.bind(statement),
                hasNamespace: !!statement.namespaceName,
                functionStatement: statement
            });
        }
    }

    private findFunctionCalls() {
        this.functionCalls = [];
        //for every function in the file
        for (let func of this.parser.references.functionExpressions) {
            //for all function calls in this function
            for (let expression of func.callExpressions) {

                if (
                    //filter out dotted function invocations (i.e. object.doSomething()) (not currently supported. TODO support it)
                    (expression.callee as any).obj ||
                    //filter out method calls on method calls for now (i.e. getSomething().getSomethingElse())
                    (expression.callee as any).callee
                ) {
                    continue;
                }
                let functionName = (expression.callee as any).name.text;

                //callee is the name of the function being called
                let callee = expression.callee as VariableExpression;

                let columnIndexBegin = callee.range.start.character;
                let columnIndexEnd = callee.range.end.character;

                let args = [] as CallableArg[];
                //TODO convert if stmts to use instanceof instead
                for (let arg of expression.args as any) {
                    //is variable being passed into argument
                    if (arg.name) {
                        args.push({
                            range: arg.range,
                            //TODO - look up the data type of the actual variable
                            type: new DynamicType(),
                            text: arg.name.text
                        });
                    } else if (arg.value) {
                        let text = '';
                        /* istanbul ignore next: TODO figure out why value is undefined sometimes */
                        if (arg.value.value) {
                            text = arg.value.value.toString();
                        }
                        let callableArg = {
                            range: arg.range,
                            type: util.valueKindToBrsType(arg.value.kind),
                            text: text
                        };
                        //wrap the value in quotes because that's how it appears in the code
                        if (isStringType(callableArg.type)) {
                            callableArg.text = '"' + callableArg.text + '"';
                        }
                        args.push(callableArg);
                    } else {
                        args.push({
                            range: arg.range,
                            type: new DynamicType(),
                            //TODO get text from other types of args
                            text: ''
                        });
                    }
                }
                let functionCall: FunctionCall = {
                    range: util.createRangeFromPositions(expression.range.start, expression.closingParen.range.end),
                    functionScope: this.getFunctionScopeAtPosition(callee.range.start),
                    file: this,
                    name: functionName,
                    nameRange: util.createRange(callee.range.start.line, columnIndexBegin, callee.range.start.line, columnIndexEnd),
                    //TODO keep track of parameters
                    args: args
                };
                this.functionCalls.push(functionCall);
            }
        }
    }

    /**
     * Find the function scope at the given position.
     * @param position
     * @param functionScopes
     */
    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope {
        if (!functionScopes) {
            functionScopes = this.functionScopes;
        }
        for (let scope of functionScopes) {
            if (util.rangeContains(scope.range, position)) {
                //see if any of that scope's children match the position also, and give them priority
                let childScope = this.getFunctionScopeAtPosition(position, scope.childrenScopes);
                if (childScope) {
                    return childScope;
                } else {
                    return scope;
                }
            }
        }
    }

    /**
     * Get completions available at the given cursor. This aggregates all values from this file and the current scope.
     */
    public async getCompletions(position: Position, scope?: Scope): Promise<CompletionItem[]> {
        let result = [] as CompletionItem[];
        let parseMode = this.getParseMode();

        //wait for the file to finish processing
        await this.isReady();
        //a map of lower-case names of all added options
        let names = {};

        //handle script import completions
        let scriptImport = util.getScriptImportAtPosition(this.ownScriptImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        }

        //if cursor is within a comment, disable completions
        let currentToken = this.getTokenAt(position);
        if (currentToken && currentToken.kind === TokenKind.Comment) {
            return [];
        }

        //determine if cursor is inside a function
        let functionScope = this.getFunctionScopeAtPosition(position);
        if (!functionScope) {
            //we aren't in any function scope, so return the keyword completions
            return KeywordCompletions;
        }

        //is next to a period (or an identifier that is next to a period). include the property names
        if (this.isPositionNextToDot(position)) {
            let namespaceCompletions = this.getNamespaceCompletions(currentToken, parseMode, scope);
            //if the text to the left of the dot is a part of a known namespace, complete with additional namespace information
            if (namespaceCompletions.length > 0) {
                result.push(...namespaceCompletions);
            } else {
                result.push(...scope.getPropertyNameCompletions());
            }

        } else {
            //include the global callables
            result.push(...scope.getCallablesAsCompletions(parseMode));

            //add `m` because that's always valid within a function
            result.push({
                label: 'm',
                kind: CompletionItemKind.Variable
            });
            names['m'] = true;

            result.push(...KeywordCompletions);

            //include local variables
            let variables = functionScope.variableDeclarations;

            for (let variable of variables) {
                //skip duplicate variable names
                if (names[variable.name.toLowerCase()]) {
                    continue;
                }
                names[variable.name.toLowerCase()] = true;
                result.push({
                    label: variable.name,
                    kind: isFunctionType(variable.type) ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }

            if (parseMode === ParseMode.BrighterScript) {
                //include the first part of namespaces
                let namespaces = scope.getNamespaceStatements();
                for (let stmt of namespaces) {
                    let firstPart = stmt.nameExpression.getNameParts().shift();
                    //skip duplicate namespace names
                    if (names[firstPart.toLowerCase()]) {
                        continue;
                    }
                    names[firstPart.toLowerCase()] = true;
                    result.push({
                        label: firstPart,
                        kind: CompletionItemKind.Module
                    });
                }
            }
        }
        return result;
    }

    private getNamespaceCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope) {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }

        let completionName = this.getPartialVariableName(currentToken);
        //remove any trailing identifer and then any trailing dot, to give us the
        //name of its immediate parent namespace
        let closestParentNamespaceName = completionName.replace(/\.([a-z0-9_]*)?$/gi, '');

        let namespaceLookup = scope.namespaceLookup;
        let result = [] as CompletionItem[];
        for (let key in namespaceLookup) {
            let namespace = namespaceLookup[key.toLowerCase()];
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullName.toLowerCase() === closestParentNamespaceName.toLowerCase()) {
                //add all of this namespace's immediate child namespaces
                for (let childKey in namespace.namespaces) {
                    result.push({
                        label: namespace.namespaces[childKey].lastPartName,
                        kind: CompletionItemKind.Module
                    });
                }

                //add function and class statement completions
                for (let stmt of namespace.statements) {
                    if (isClassStatement(stmt)) {
                        result.push({
                            label: stmt.name.text,
                            kind: CompletionItemKind.Class
                        });
                    } else if (isFunctionStatement(stmt)) {
                        result.push({
                            label: stmt.name.text,
                            kind: CompletionItemKind.Function
                        });
                    }

                }

            }
        }

        return result;
    }
    /**
     * Given a current token, walk
     */
    private getPartialVariableName(currentToken: Token) {
        let identifierAndDotKinds = [TokenKind.Identifier, ...AllowedLocalIdentifiers, TokenKind.Dot];

        //consume tokens backwards until we find something other than a dot or an identifier
        let tokens = [];
        for (let i = this.parser.tokens.indexOf(currentToken); i >= 0; i--) {
            currentToken = this.parser.tokens[i];
            if (identifierAndDotKinds.includes(currentToken.kind)) {
                tokens.unshift(currentToken.text);
            } else {
                break;
            }
        }

        //if we found name and dot tokens, join them together to make the namespace name
        if (tokens.length > 0) {
            return tokens.join('');
        } else {
            return undefined;
        }
    }

    /**
     * Determine if this file is a brighterscript file
     */
    private getParseMode() {
        return this.pathAbsolute.toLowerCase().endsWith('.bs') ? ParseMode.BrighterScript : ParseMode.BrightScript;
    }

    private isPositionNextToDot(position: Position) {
        let closestToken = this.getClosestToken(position);
        let previousToken = this.getPreviousToken(closestToken);
        //next to a dot
        if (closestToken.kind === TokenKind.Dot) {
            return true;
        } else if (closestToken.kind === TokenKind.Newline || previousToken.kind === TokenKind.Newline) {
            return false;
            //next to an identifier, which is next to a dot
        } else if (closestToken.kind === TokenKind.Identifier && previousToken.kind === TokenKind.Dot) {
            return true;
        } else {
            return false;
        }
    }

    public getPreviousToken(token: Token) {
        let idx = this.parser.tokens.indexOf(token);
        return this.parser.tokens[idx - 1];
    }

    /**
     * Find the first scope that has a namespace with this name.
     * Returns false if no namespace was found with that name
     */
    public calleeStartsWithNamespace(callee: Expression) {
        let left = callee as any;
        while (isDottedGetExpression(left)) {
            left = left.obj;
        }

        if (isVariableExpression(left)) {
            let lowerName = left.name.text.toLowerCase();
            //find the first scope that contains this namespace
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                if (scope.namespaceLookup[lowerName]) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Determine if the callee (i.e. function name) is a known function declared on the given namespace.
     */
    public calleeIsKnownNamespaceFunction(callee: Expression, namespaceName: string) {
        //if we have a variable and a namespace
        if (isVariableExpression(callee) && namespaceName) {
            let lowerCalleeName = callee.name.text.toLowerCase();
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                let namespace = scope.namespaceLookup[namespaceName.toLowerCase()];
                if (namespace.functionStatements[lowerCalleeName]) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the token closest to the position. if no token is found, the previous token is returned
     * @param position
     * @param tokens
     */
    public getClosestToken(position: Position) {
        let tokens = this.parser.tokens;
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (util.rangeContains(token.range, position)) {
                return token;
            }
            //if the position less than this token range, then this position touches no token,
            if (util.positionIsGreaterThanRange(position, token.range) === false) {
                let t = tokens[i - 1];
                //return the token or the first token
                return t ? t : tokens[0];
            }
        }
        //return the last token
        return tokens[tokens.length - 1];
    }

    /**
     * Builds a list of document symbols for this file. Used by LanguageServer's onDocumentSymbol functionality
     */
    public async getDocumentSymbols() {
        if (this.documentSymbols) {
            return this.documentSymbols;
        }

        let symbols = [] as DocumentSymbol[];
        await this.isReady();

        for (const statement of this.ast.statements) {
            const symbol = this.getDocumentSymbol(statement);
            if (symbol) {
                symbols.push(symbol);
            }
        }
        this.documentSymbols = symbols;
        return symbols;
    }

    /**
     * Builds a list of workspace symbols for this file. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public async getWorkspaceSymbols() {
        if (this.workspaceSymbols) {
            return this.workspaceSymbols;
        }

        let symbols = [] as SymbolInformation[];
        await this.isReady();

        for (const statement of this.ast.statements) {
            const symbol = this.getWorkspaceSymbol(statement);
            if (symbol) {
                symbols.push(symbol);
            }
        }
        this.workspaceSymbols = symbols;
        return symbols;
    }

    /**
     * Builds a single DocumentSymbol object for use by LanguageServer's onDocumentSymbol functionality
     */
    private getDocumentSymbol(statement: Statement) {
        let symbolKind: SymbolKind;
        let children = [] as DocumentSymbol[];
        if (statement instanceof FunctionStatement) {
            symbolKind = SymbolKind.Function;
        } else if (statement instanceof NamespaceStatement) {
            symbolKind = SymbolKind.Namespace;
            for (const childStatement of statement.body.statements) {
                const symbol = this.getDocumentSymbol(childStatement);
                if (symbol) {
                    children.push(symbol);
                }
            }
        } else if (statement instanceof ClassStatement) {
            symbolKind = SymbolKind.Class;
        } else {
            return;
        }

        const name = statement.getName(ParseMode.BrighterScript);
        return DocumentSymbol.create(name, '', symbolKind, statement.range, statement.range, children);
    }

    /**
     * Builds a single SymbolInformation object for use by LanguageServer's onWorkspaceSymbol functionality
     */
    private getWorkspaceSymbol(statement: Statement) {
        let symbolKind: SymbolKind;
        if (statement instanceof FunctionStatement) {
            symbolKind = SymbolKind.Function;
        } else if (statement instanceof NamespaceStatement) {
            symbolKind = SymbolKind.Namespace;
        } else if (statement instanceof ClassStatement) {
            symbolKind = SymbolKind.Class;
        } else {
            return;
        }

        const name = statement.getName(ParseMode.BrighterScript);
        const uri = util.pathToUri(this.pathAbsolute);
        return SymbolInformation.create(name, symbolKind, statement.range, uri);
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public async getDefinition(position: Position) {
        await this.isReady();

        let results: Location[] = [];

        //get the token at the position
        const token = this.getTokenAt(position);

        let definitionTokenTypes = [
            TokenKind.Identifier
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return results;
        }

        const lowerTokenText = token.text.toLowerCase();

        //look through local variables first, get the function scope for this position (if it exists)
        const functionScope = this.getFunctionScopeAtPosition(position);
        if (functionScope) {
            //find any variable with this name
            for (const varDeclaration of functionScope.variableDeclarations) {
                //we found a variable declaration with this token text!
                if (varDeclaration.name.toLowerCase() === lowerTokenText) {
                    const uri = util.pathToUri(this.pathAbsolute);
                    results.push(Location.create(uri, varDeclaration.nameRange));
                }
            }
        }

        //look through all callables in relevant scopes
        for (const scope of this.program.getScopesForFile(this)) {
            let callable = scope.getCallableByName(lowerTokenText);
            if (callable) {
                const uri = util.pathToUri(callable.file.pathAbsolute);
                results.push(Location.create(uri, callable.range));
            }
        }

        return results;
    }

    public async getHover(position: Position): Promise<Hover> {
        await this.isReady();
        //get the token at the position
        let token = this.getTokenAt(position);

        let hoverTokenTypes = [
            TokenKind.Identifier,
            TokenKind.Function,
            TokenKind.EndFunction,
            TokenKind.Sub,
            TokenKind.EndSub
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !hoverTokenTypes.includes(token.kind)) {
            return null;
        }

        let lowerTokenText = token.text.toLowerCase();

        //look through local variables first
        {
            //get the function scope for this position (if exists)
            let functionScope = this.getFunctionScopeAtPosition(position);
            if (functionScope) {
                //find any variable with this name
                for (let varDeclaration of functionScope.variableDeclarations) {
                    //we found a variable declaration with this token text!
                    if (varDeclaration.name.toLowerCase() === lowerTokenText) {
                        let typeText: string;
                        if (isFunctionType(varDeclaration.type)) {
                            typeText = varDeclaration.type.toString();
                        } else {
                            typeText = `${varDeclaration.name} as ${varDeclaration.type.toString()}`;
                        }
                        return {
                            range: token.range,
                            //append the variable name to the front for scope
                            contents: typeText
                        };
                    }
                }
            }
        }

        //look through all callables in relevant scopes
        {
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                let callable = scope.getCallableByName(lowerTokenText);
                if (callable) {
                    return {
                        range: token.range,
                        contents: callable.type.toString()
                    };
                }
            }
        }
    }

    public async getSignatureHelp(callable: Callable) {
        await this.isReady();

        const statement = callable.functionStatement;
        const func = statement.func;
        const funcStartPosition = func.range.start;

        // Get function comments in reverse order
        let currentToken = this.getTokenAt(funcStartPosition);
        let functionComments = [] as string[];
        while (true) {
            currentToken = this.getPreviousToken(currentToken);
            if (!currentToken) {
                break;
            }
            if (currentToken.range.start.line + 1 < funcStartPosition.line) {
                if (functionComments.length === 0) {
                    break;
                }
            }

            const kind = currentToken.kind;
            if (kind === TokenKind.Comment) {
                // Strip off common leading characters to make it easier to read
                const commentText = currentToken.text.replace(/^[' *\/]+/, '');
                functionComments.unshift(commentText);
            } else if (kind === TokenKind.Newline) {
                if (functionComments.length === 0) {
                    continue;
                }
                // if we already had a new line as the last token then exit out
                if (functionComments[0] === currentToken.text) {
                    break;
                }
                functionComments.unshift(currentToken.text);
            } else {
                break;
            }
        }
        const documentation = functionComments.join('').trim();

        const lines = util.splitStringIntoLines(this.fileContents);

        const params = [] as ParameterInformation[];
        for (const param of func.parameters) {
            params.push(ParameterInformation.create(param.name.text));
        }

        const label = util.getTextForRange(lines, util.createRangeFromPositions(func.functionType.range.start, func.body.range.start)).trim();
        const signature = SignatureInformation.create(label, documentation, ...params);
        return signature;
    }

    public async getReferences(position: Position) {
        await this.isReady();

        const callSiteToken = this.getTokenAt(position);

        let locations = [] as Location[];

        // No need to actually look if they didn't select a token we can search against
        if (callSiteToken.kind !== TokenKind.Identifier) {
            return locations;
        }
        console.log('callSiteToken.kind', callSiteToken.kind);
        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.program.getScopesForFile(this);

        for (const scope of scopes) {
            for (const file of scope.getFiles()) {
                if (file instanceof BrsFile) {
                    file.ast.walk(createVisitor({
                        VariableExpression: (e) => {
                            if (e.name.text.toLowerCase() === searchFor) {
                                locations.push(Location.create(util.pathToUri(file.pathAbsolute), e.range));
                            }
                        }
                    }),
                    {
                        walkMode: WalkMode.visitExpressionsRecursive
                    });
                }
            }
        }
        return locations;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile() {
        const state = new TranspileState(this);
        if (this.needsTranspiled) {
            let programNode = new SourceNode(null, null, this.pathAbsolute, this.ast.transpile(state));
            let result = programNode.toStringWithSourceMap({
                file: this.pathAbsolute
            });
            return result;
        } else {
            //create a source map from the original source code
            let chunks = [] as (SourceNode | string)[];
            let lines = util.splitStringIntoLines(this.fileContents);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                let line = lines[lineIndex];
                chunks.push(
                    lineIndex > 0 ? '\n' : '',
                    new SourceNode(lineIndex + 1, 0, state.pathAbsolute, line)
                );
            }
            return new SourceNode(null, null, state.pathAbsolute, chunks).toStringWithSourceMap();
        }
    }

    public dispose() {
        this.parser?.dispose();
    }
}

/**
 * List of completions for all valid keywords/reserved words.
 * Build this list once because it won't change for the lifetime of this process
 */
export const KeywordCompletions = Object.keys(Keywords)
    //remove any keywords with whitespace
    .filter(x => !x.includes(' '))
    //create completions
    .map(x => {
        return {
            label: x,
            kind: CompletionItemKind.Keyword
        } as CompletionItem;
    });
