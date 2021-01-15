import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Hover, Range, Position } from 'vscode-languageserver';
import { CompletionItemKind, SymbolKind, Location, SignatureInformation, ParameterInformation, DocumentSymbol, SymbolInformation } from 'vscode-languageserver';
import chalk from 'chalk';
import * as path from 'path';
import type { Scope } from '../Scope';
import { diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import type { Callable, CallableArg, CallableParam, CommentFlag, FunctionCall, BsDiagnostic, FileReference } from '../interfaces';
import type { Token } from '../lexer';
import { Lexer, TokenKind, AllowedLocalIdentifiers, Keywords } from '../lexer';
import { Parser, ParseMode } from '../parser';
import type { FunctionExpression, VariableExpression, Expression } from '../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, ClassMethodStatement, LibraryStatement, ImportStatement, Statement } from '../parser/Statement';
import type { Program } from '../Program';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { VoidType } from '../types/VoidType';
import { standardizePath as s, util } from '../util';
import { TranspileState } from '../parser/TranspileState';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';
import { isClassMethodStatement, isClassStatement, isCommentStatement, isDottedGetExpression, isFunctionStatement, isFunctionType, isImportStatement, isLibraryStatement, isLiteralExpression, isNamespaceStatement, isStringType, isVariableExpression, isXmlFile } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyGraph } from '../DependencyGraph';

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

        this.extension = util.getExtension(this.pkgPath);

        //all BrighterScript files need to be transpiled
        if (this.extension?.endsWith('.bs')) {
            this.needsTranspiled = true;
        }
        this.isTypedef = this.extension === '.d.bs';
        if (!this.isTypedef) {
            this.typedefKey = util.getTypedefPath(this.pathAbsolute);
        }

        //global file doesn't have a program, so only resolve typedef info if we have a program
        if (this.program) {
            this.resolveTypedef();
        }
    }

    /**
     * The parseMode used for the parser for this file
     */
    public get parseMode() {
        return this.extension.endsWith('.bs') ? ParseMode.BrighterScript : ParseMode.BrightScript;
    }

    /**
     * The key used to identify this file in the dependency graph
     */
    public dependencyGraphKey: string;
    /**
     * The all-lowercase extension for this file (including the leading dot)
     */
    public extension: string;

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

    public get parser() {
        if (!this._parser) {
            //remove the typedef file (if it exists)
            this.hasTypedef = false;
            this.typedefFile = undefined;

            //parse the file (it should parse fully since there's no linked typedef
            this.parse(this.fileContents);

            //re-link the typedef (if it exists...which it should)
            this.resolveTypedef();
        }
        return this._parser;
    }
    private _parser: Parser;

    public fileContents: string;

    /**
     * If this is a typedef file
     */
    public isTypedef: boolean;

    /**
     * The key to find the typedef file in the program's files map.
     * A falsey value means this file is ineligable for a typedef
     */
    public typedefKey?: string;

    /**
     * If the file was given type definitions during parse
     */
    public hasTypedef;

    /**
     * A reference to the typedef file (if one exists)
     */
    public typedefFile?: BrsFile;

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * Find and set the typedef variables (if a matching typedef file exists)
     */
    private resolveTypedef() {
        this.typedefFile = this.program.getFileByPathAbsolute<BrsFile>(this.typedefKey);
        this.hasTypedef = !!this.typedefFile;
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //event that fires anytime a dependency changes
        this.unsubscribeFromDependencyGraph = this.program.dependencyGraph.onchange(this.dependencyGraphKey, () => {
            this.resolveTypedef();
        });

        const dependencies = this.ownScriptImports.filter(x => !!x.pkgPath).map(x => x.pkgPath.toLowerCase());

        //if this is a .brs file, watch for typedef changes
        if (this.extension === '.brs') {
            dependencies.push(
                util.getTypedefPath(this.pkgPath)
            );
        }
        dependencyGraph.addOrReplace(this.dependencyGraphKey, dependencies);
    }

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public parse(fileContents: string) {
        try {
            this.fileContents = fileContents;
            this.diagnostics = [];

            //if we have a typedef file, skip parsing this file
            if (this.hasTypedef) {
                return;
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

            this.program.logger.time(LogLevel.debug, ['parser.parse', chalk.green(this.pathAbsolute)], () => {
                this._parser = Parser.parse(tokens, {
                    mode: this.parseMode,
                    logger: this.program.logger
                });
            });

            //absorb all lexing/preprocessing/parsing diagnostics
            this.diagnostics.push(
                ...lexer.diagnostics as BsDiagnostic[],
                ...preprocessor.diagnostics as BsDiagnostic[],
                ...this._parser.diagnostics as BsDiagnostic[]
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
            this._parser = new Parser();
            this.diagnostics.push({
                file: this,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE),
                ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(serializeError(e)))
            });
        }
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
            ...this._parser.references.libraryStatements,
            ...this._parser.references.importStatements
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
                const cls = scope.getClass(lowerClassName);
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
                let possibleGlobalClass = scope.getClass(lowerClassName);
                if (possibleGlobalClass && !globalClass) {
                    globalClass = possibleGlobalClass;
                }
                if (namespaceName) {
                    let possibleNamespacedClass = scope.getClass(namespaceName.toLowerCase() + '.' + lowerClassName);
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

    public findPropertyNameCompletions(): CompletionItem[] {
        //Build completion items from all the "properties" found in the file
        const { propertyHints } = this.parser.references;
        const results = [] as CompletionItem[];
        for (const key of Object.keys(propertyHints)) {
            results.push({
                label: propertyHints[key],
                kind: CompletionItemKind.Text
            });
        }
        return results;
    }

    private _propertyNameCompletions: CompletionItem[];

    public get propertyNameCompletions(): CompletionItem[] {
        if (!this._propertyNameCompletions) {
            this._propertyNameCompletions = this.findPropertyNameCompletions();
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
                    if (isNaN(codeInt)) {
                        //don't validate non-numeric codes
                        continue;
                    }
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

    private findCallables() {
        for (let statement of this.parser.references.functionStatements ?? []) {

            let functionType = new FunctionType(statement.func.returnType);
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
                    type: param.type,
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
        for (let func of this._parser.references.functionExpressions) {
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

                    //is a literal parameter value
                    if (isLiteralExpression(arg)) {
                        args.push({
                            range: arg.range,
                            type: arg.type,
                            text: arg.token.text
                        });

                        //is variable being passed into argument
                    } else if (arg.name) {
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
                            //TODO not sure what to do here
                            type: new DynamicType(), // util.valueKindToBrsType(arg.value.kind),
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
                let functionCall = {
                    range: util.createRangeFromPositions(expression.range.start, expression.closingParen.range.end),
                    functionExpression: this.getFunctionExpressionAtPosition(callee.range.start),
                    file: this,
                    name: functionName,
                    nameRange: util.createRange(callee.range.start.line, columnIndexBegin, callee.range.start.line, columnIndexEnd),
                    //TODO keep track of parameters
                    args: args
                } as FunctionCall;
                this.functionCalls.push(functionCall);
            }
        }
    }

    /**
     * Find the function expression at the given position.
     */
    public getFunctionExpressionAtPosition(position: Position, functionExpressions?: FunctionExpression[]): FunctionExpression {
        if (!functionExpressions) {
            functionExpressions = this.parser.references.functionExpressions;
        }
        for (let functionExpression of functionExpressions) {
            if (util.rangeContains(functionExpression.range, position)) {
                //see if any of that scope's children match the position also, and give them priority
                let childFunc = this.getFunctionExpressionAtPosition(position, functionExpression.childFunctionExpressions);
                if (childFunc) {
                    return childFunc;
                } else {
                    return functionExpression;
                }
            }
        }
    }

    /**
     * Get completions available at the given cursor. This aggregates all values from this file and the current scope.
     */
    public getCompletions(position: Position, scope?: Scope): CompletionItem[] {
        let result = [] as CompletionItem[];
        let parseMode = this.getParseMode();

        //a map of lower-case names of all added options
        let names = {} as Record<string, boolean>;

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
        let functionExpression = this.getFunctionExpressionAtPosition(position);
        if (!functionExpression) {
            //we aren't in any function expression, so return the keyword completions
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
            names.m = true;

            result.push(...KeywordCompletions);

            //include local variables
            let localVars = this.parser.references.localVars.get(functionExpression);

            for (let localVar of localVars) {
                //skip duplicate variable names
                if (names[localVar.lowerName]) {
                    continue;
                }
                names[localVar.lowerName] = true;
                result.push({
                    label: localVar.nameToken.text,
                    //TODO find type for local vars
                    kind: CompletionItemKind.Variable
                    // kind: isFunctionType(variable.type) ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }

            if (parseMode === ParseMode.BrighterScript) {
                //include the first part of namespaces
                let namespaces = scope.getAllNamespaceStatements();
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
        const parser = this.parser;
        for (let i = parser.tokens.indexOf(currentToken); i >= 0; i--) {
            currentToken = parser.tokens[i];
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
    public getParseMode() {
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
        const parser = this.parser;
        let idx = parser.tokens.indexOf(token);
        return parser.tokens[idx - 1];
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
    public getDocumentSymbols() {
        if (this.documentSymbols) {
            return this.documentSymbols;
        }

        let symbols = [] as DocumentSymbol[];

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
    public getWorkspaceSymbols() {
        if (this.workspaceSymbols) {
            return this.workspaceSymbols;
        }

        let symbols = [] as SymbolInformation[];

        for (const statement of this.ast.statements) {
            for (const symbol of this.generateWorkspaceSymbols(statement)) {
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
        const children = [] as DocumentSymbol[];

        if (isFunctionStatement(statement)) {
            symbolKind = SymbolKind.Function;
        } else if (isClassMethodStatement(statement)) {
            symbolKind = SymbolKind.Method;
        } else if (isNamespaceStatement(statement)) {
            symbolKind = SymbolKind.Namespace;
            for (const childStatement of statement.body.statements) {
                const symbol = this.getDocumentSymbol(childStatement);
                if (symbol) {
                    children.push(symbol);
                }
            }
        } else if (isClassStatement(statement)) {
            symbolKind = SymbolKind.Class;
            for (const childStatement of statement.body) {
                const symbol = this.getDocumentSymbol(childStatement);
                if (symbol) {
                    children.push(symbol);
                }
            }
        } else {
            return;
        }

        const name = statement.getName(ParseMode.BrighterScript);
        return DocumentSymbol.create(name, '', symbolKind, statement.range, statement.range, children);
    }

    /**
     * Builds a single SymbolInformation object for use by LanguageServer's onWorkspaceSymbol functionality
     */
    private generateWorkspaceSymbols(statement: Statement, containerStatement?: ClassStatement | NamespaceStatement) {
        let symbolKind: SymbolKind;
        const symbols = [];

        if (isFunctionStatement(statement)) {
            symbolKind = SymbolKind.Function;
        } else if (isClassMethodStatement(statement)) {
            symbolKind = SymbolKind.Method;
        } else if (isNamespaceStatement(statement)) {
            symbolKind = SymbolKind.Namespace;

            for (const childStatement of statement.body.statements) {
                for (const symbol of this.generateWorkspaceSymbols(childStatement, statement)) {
                    symbols.push(symbol);
                }
            }
        } else if (isClassStatement(statement)) {
            symbolKind = SymbolKind.Class;

            for (const childStatement of statement.body) {
                for (const symbol of this.generateWorkspaceSymbols(childStatement, statement)) {
                    symbols.push(symbol);
                }
            }
        } else {
            return symbols;
        }

        const name = statement.getName(ParseMode.BrighterScript);
        const uri = util.pathToUri(this.pathAbsolute);
        const symbol = SymbolInformation.create(name, symbolKind, statement.range, uri, containerStatement?.getName(ParseMode.BrighterScript));
        symbols.push(symbol);
        return symbols;
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public getDefinition(position: Position) {
        let results: Location[] = [];

        //get the token at the position
        const token = this.getTokenAt(position);

        // While certain other tokens are allowed as local variables (AllowedLocalIdentifiers: https://github.com/rokucommunity/brighterscript/blob/master/src/lexer/TokenKind.ts#L418), these are converted by the parser to TokenKind.Identifier by the time we retrieve the token using getTokenAt
        let definitionTokenTypes = [
            TokenKind.Identifier,
            TokenKind.StringLiteral
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return results;
        }

        let textToSearchFor = token.text.toLowerCase();

        if (token.kind === TokenKind.StringLiteral) {
            // We need to strip off the quotes but only if present
            const startIndex = textToSearchFor.startsWith('"') ? 1 : 0;

            let endIndex = textToSearchFor.length;
            if (textToSearchFor.endsWith('"')) {
                endIndex--;
            }
            textToSearchFor = textToSearchFor.substring(startIndex, endIndex);
        }

        //look through local variables first
        const localVars = this.getLocalVarsAtPosition(position);
        //find any variable with this name
        for (const localVar of localVars) {
            //we found a variable declaration with this token text
            if (localVar.lowerName === textToSearchFor) {
                const uri = util.pathToUri(this.pathAbsolute);
                results.push(Location.create(uri, localVar.nameToken.range));
            }
        }

        const filesSearched = {};
        //look through all files in scope for matches
        for (const scope of this.program.getScopesForFile(this)) {
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || filesSearched[file.pathAbsolute]) {
                    continue;
                }
                filesSearched[file.pathAbsolute] = true;

                const statementHandler = (statement: FunctionStatement | ClassMethodStatement) => {
                    if (statement.getName(this.getParseMode()).toLowerCase() === textToSearchFor) {
                        const uri = util.pathToUri(file.pathAbsolute);
                        results.push(Location.create(uri, statement.range));
                    }
                };

                file.parser.ast.walk(createVisitor({
                    FunctionStatement: statementHandler,
                    ClassMethodStatement: statementHandler
                }), {
                    walkMode: WalkMode.visitStatements
                });
            }
        }
        return results;
    }

    /**
     * Get local variables at the given position.
     * Will return empty array if none are found or if position is outside function boundaries
     */
    public getLocalVarsAtPosition(position: Position) {
        let functionExpression = this.getFunctionExpressionAtPosition(position);
        return this.parser.references.localVars.get(functionExpression) ?? [];
    }

    public getHover(position: Position): Promise<Hover> {
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
            const localVars = this.getLocalVarsAtPosition(position);
            //find any variable with this name
            for (let localVar of localVars) {
                //we found a variable declaration with this token text!
                if (localVar.lowerName === lowerTokenText) {
                    let typeText: string;
                    //TODO figure out what type this var is
                    if (isFunctionType(localVar.type)) {
                        typeText = localVar.type.toString();
                    } else {
                        typeText = `${localVar.nameToken.text} as ${localVar.type.toString()}`;
                    }
                    return {
                        range: token.range,
                        //append the variable name to the front for scope
                        contents: typeText
                    };
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

    public getSignatureHelp(statement: FunctionStatement | ClassMethodStatement) {
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

        const lines = util.splitIntoLines(this.fileContents);

        const params = [] as ParameterInformation[];
        for (const param of func.parameters) {
            params.push(ParameterInformation.create(param.name.text));
        }

        const label = util.getTextForRange(lines, util.createRangeFromPositions(func.functionType.range.start, func.body.range.start)).trim();
        const signature = SignatureInformation.create(label, documentation, ...params);
        return signature;
    }

    public getReferences(position: Position) {
        const callSiteToken = this.getTokenAt(position);

        let locations = [] as Location[];

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.program.getScopesForFile(this);

        for (const scope of scopes) {
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file)) {
                    continue;
                }

                file.ast.walk(createVisitor({
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            locations.push(Location.create(util.pathToUri(file.pathAbsolute), e.range));
                        }
                    }
                }), {
                    walkMode: WalkMode.visitExpressionsRecursive
                });
            }
        }
        return locations;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new TranspileState(this);
        if (this.needsTranspiled) {
            let programNode = new SourceNode(null, null, this.pathAbsolute, this.ast.transpile(state));
            if (this.program.options.sourceMap) {
                //sourcemap reference
                let programWithMap = new SourceNode(null, null, null, [
                    programNode,
                    `'//# sourceMappingURL=./${path.basename(state.pathAbsolute)}.map`
                ]);
                return programWithMap.toStringWithSourceMap({
                    file: state.pathAbsolute
                });
            } else {
                //return the code without the source map
                return {
                    code: programNode.toString(),
                    map: undefined
                };
            }
        } else {
            if (this.program.options.sourceMap) {
                //create a source map from the original source code
                let chunks = [] as (SourceNode | string)[];
                let lines = util.splitIntoLines(this.fileContents);
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    let line = lines[lineIndex];
                    chunks.push(
                        lineIndex > 0 ? '\n' : '',
                        new SourceNode(lineIndex + 1, 0, state.pathAbsolute, line)
                    );
                }
                //sourcemap reference
                chunks.push(`'//# sourceMappingURL=./${path.basename(state.pathAbsolute)}.map`);
                return new SourceNode(null, null, state.pathAbsolute, chunks).toStringWithSourceMap();
            } else {
                //return the original source code as-is
                return {
                    code: this.fileContents,
                    map: undefined
                };
            }
        }
    }

    public getTypedef() {
        const state = new TranspileState(this);
        const typedef = this.ast.getTypedef(state);
        const programNode = new SourceNode(null, null, this.pathAbsolute, typedef);
        return programNode.toString();
    }

    public dispose() {
        this._parser?.dispose();
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
