/* eslint-disable camelcase */

import { DiagnosticSeverity, Position } from 'vscode-languageserver';
import { TokenKind } from './lexer/TokenKind';

/**
 * An object that keeps track of all possible error messages.
 */
export let DiagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: (message: string) => ({
        message: message,
        code: 1000,
        severity: DiagnosticSeverity.Error
    }),
    callToUnknownFunction: (name: string, scopeName: string) => ({
        message: `Cannot find function with name '${name}' when this file is included in scope '${scopeName}'`,
        code: 1001,
        severity: DiagnosticSeverity.Error
    }),
    mismatchArgumentCount: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        code: 1002,
        severity: DiagnosticSeverity.Error
    }),
    duplicateFunctionImplementation: (functionName: string, scopeName: string) => ({
        message: `Duplicate function implementation for '${functionName}' when this file is included in scope '${scopeName}'.`,
        code: 1003,
        severity: DiagnosticSeverity.Error
    }),
    referencedFileDoesNotExist: () => ({
        message: `Referenced file does not exist.`,
        code: 1004,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingComponentDeclaration: () => ({
        message: `Missing a component declaration.`,
        code: 1005,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingNameAttribute: () => ({
        message: `Component must have a name attribute.`,
        code: 1006,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingExtendsAttribute: () => ({
        message: `Component is mising "extends" attribute and will automatically extend "Group" by default`,
        code: 1007,
        severity: DiagnosticSeverity.Warning
    }),
    xmlGenericParseError: (message: string) => ({
        //generic catchall xml parse error
        message: message,
        code: 1008,
        severity: DiagnosticSeverity.Error
    }),
    unnecessaryScriptImportInChildFromParent: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component '${parentComponentName}'.`,
        code: 1009,
        severity: DiagnosticSeverity.Warning
    }),
    overridesAncestorFunction: (callableName: string, currentScopeName: string, parentFilePath: string, parentScopeName: string) => ({
        message: `Function '${callableName}' included in '${currentScopeName}' overrides function in '${parentFilePath}' included in '${parentScopeName}'.`,
        code: 1010,
        severity: DiagnosticSeverity.Hint
    }),
    localVarFunctionShadowsParentFunction: (scopeName: 'stdlib' | 'scope') => ({
        message: `Local variable function has same name as ${scopeName} function and will never be called.`,
        code: 1011,
        severity: DiagnosticSeverity.Warning
    }),
    scriptImportCaseMismatch: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path '${correctFilePath}'.`,
        code: 1012,
        severity: DiagnosticSeverity.Warning
    }),
    fileNotReferencedByAnyOtherFile: () => ({
        message: `This file is not referenced by any other file in the project.`,
        code: 1013,
        severity: DiagnosticSeverity.Warning
    }),
    unknownDiagnosticCode: (theUnknownCode: number) => ({
        message: `Unknown diagnostic code ${theUnknownCode}`,
        code: 1014,
        severity: DiagnosticSeverity.Warning
    }),
    scriptSrcCannotBeEmpty: () => ({
        message: `Script import cannot be empty or whitespace`,
        code: 1015,
        severity: DiagnosticSeverity.Error
    }),
    expectedIdentifierAfterKeyword: (keywordText: string) => ({
        message: `Expected identifier after '${keywordText}' keyword`,
        code: 1016,
        severity: DiagnosticSeverity.Error
    }),
    missingCallableKeyword: () => ({
        message: `Expected 'function' or 'sub' to preceed identifier`,
        code: 1017,
        severity: DiagnosticSeverity.Error
    }),
    expectedValidTypeToFollowAsKeyword: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        code: 1018,
        severity: DiagnosticSeverity.Error
    }),
    bsFeatureNotSupportedInBrsFiles: (featureName) => ({
        message: `BrighterScript feature '${featureName}' is not supported in standard BrightScript files`,
        code: 1019,
        severity: DiagnosticSeverity.Error
    }),
    brsConfigJsonIsDeprecated: () => ({
        message: `'brsconfig.json' is deprecated. Please rename to 'bsconfig.json'`,
        code: 1020,
        severity: DiagnosticSeverity.Warning
    }),
    bsConfigJsonHasSyntaxErrors: (message: string) => ({
        message: `Encountered syntax errors in bsconfig.json: ${message}`,
        code: 1021,
        severity: DiagnosticSeverity.Error
    }),
    namespacedClassCannotShareNamewithNonNamespacedClass: (nonNamespacedClassName: string) => ({
        message: `Namespaced class cannot have the same name as a non-namespaced class '${nonNamespacedClassName}'`,
        code: 1022,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseOverrideKeywordOnConstructorFunction: () => ({
        message: 'Override keyword is not allowed on class constructor method',
        code: 1023,
        severity: DiagnosticSeverity.Error
    }),
    importStatementMustBeDeclaredAtTopOfFile: () => ({
        message: `'import' statement must be declared at the top of the file`,
        code: 1024,
        severity: DiagnosticSeverity.Error
    }),
    methodDoesNotExistOnType: (methodName: string, className: string) => ({
        message: `Method '${methodName}' does not exist on type '${className}'`,
        code: 1025,
        severity: DiagnosticSeverity.Error
    }),
    duplicateIdentifier: (memberName: string) => ({
        message: `Duplicate identifier '${memberName}'`,
        code: 1026,
        severity: DiagnosticSeverity.Error
    }),
    missingOverrideKeyword: (ancestorClassName: string) => ({
        message: `Method has no override keyword but is declared in ancestor class '${ancestorClassName}'`,
        code: 1027,
        severity: DiagnosticSeverity.Error
    }),
    duplicateClassDeclaration: (scopeName: string, className: string) => ({
        message: `Scope '${scopeName}' already contains a class with name '${className}'`,
        code: 1028,
        severity: DiagnosticSeverity.Error
    }),
    classCouldNotBeFound: (className: string, scopeName: string) => ({
        message: `Class '${className}' could not be found when this file is included in scope '${scopeName}'`,
        code: 1029,
        severity: DiagnosticSeverity.Error
    }),
    expectedClassFieldIdentifier: () => ({
        message: `Expected identifier in class body`,
        code: 1030,
        severity: DiagnosticSeverity.Error
    }),
    expressionIsNotConstructable: (expressionType: string) => ({
        message: `Cannot use the 'new' keyword here because '${expressionType}' is not a constructable type`,
        code: 1031,
        severity: DiagnosticSeverity.Error
    }),
    expectedClassKeyword: () => ({
        message: `Expected 'class' keyword`,
        code: 1032,
        severity: DiagnosticSeverity.Error
    }),
    expectedLeftParenAfterCallable: (callableType: string) => ({
        message: `Expected '(' after ${callableType}`,
        code: 1033,
        severity: DiagnosticSeverity.Error
    }),
    expectedNameAfterCallableKeyword: (callableType: string) => ({
        message: `Expected ${callableType} name after '${callableType}' keyword`,
        code: 1034,
        severity: DiagnosticSeverity.Error
    }),
    expectedLeftParenAfterCallableName: (callableType: string) => ({
        message: `Expected '(' after ${callableType} name`,
        code: 1035,
        severity: DiagnosticSeverity.Error
    }),
    tooManyCallableParameters: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} parameters but found ${actual})`,
        code: 1036,
        severity: DiagnosticSeverity.Error
    }),
    invalidFunctionReturnType: (typeText: string) => ({
        message: `Function return type '${typeText}' is invalid`,
        code: 1037,
        severity: DiagnosticSeverity.Error
    }),
    requiredParameterMayNotFollowOptionalParameter: (parameterName: string) => ({
        message: `Required parameter '${parameterName}' must be declared before any optional parameters`,
        code: 1038,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColonAfterCallableSignature: (callableType: string) => ({
        message: `Expected newline or ':' after ${callableType} signature`,
        code: 1039,
        severity: DiagnosticSeverity.Error
    }),
    functionNameCannotEndWithTypeDesignator: (callableType: string, name: string, designator: string) => ({
        message: `${callableType} name '${name}' cannot end with type designator '${designator}'`,
        code: 1040,
        severity: DiagnosticSeverity.Error
    }),
    callableBlockMissingEndKeyword: (callableType: string) => ({
        message: `Expected 'end ${callableType}' to terminate ${callableType} block`,
        code: 1041,
        severity: DiagnosticSeverity.Error
    }),
    mismatchedEndCallableKeyword: (expectedCallableType: string, actualCallableType: string) => ({
        message: `Expected 'end ${expectedCallableType}' to terminate ${expectedCallableType} block but found 'end ${actualCallableType}' instead.`,
        code: 1042,
        severity: DiagnosticSeverity.Error
    }),
    expectedParameterNameButFound: (text: string) => ({
        message: `Expected parameter name, but found '${text ?? ''}'`,
        code: 1043,
        severity: DiagnosticSeverity.Error
    }),
    functionParameterTypeIsInvalid: (parameterName: string, typeText: string) => ({
        message: `Function parameter '${parameterName}' is of invalid type '${parameterName}'`,
        code: 1044,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseReservedWordAsIdentifier: (name: string) => ({
        message: `Cannot use reserved word '${name}' as an identifier`,
        code: 1045,
        severity: DiagnosticSeverity.Error
    }),
    expectedOperatorAfterIdentifier: (operators: TokenKind[], name: string) => {
        operators = Array.isArray(operators) ? operators : [];
        return {
            message: `Expected operator ('${operators.join(`', '`)}') after idenfifier '${name}'`,
            code: 1046,
            severity: DiagnosticSeverity.Error
        };
    },
    expectedNewlineOrColonAfterAssignment: () => ({
        message: `Expected newline or ':' after assignment`,
        code: 1047,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineAfterWhileCondition: () => ({
        message: `Expected newline after while condition`,
        code: 1048,
        severity: DiagnosticSeverity.Error
    }),
    couldNotFindMatchingEndKeyword: (keyword: string) => ({
        message: `Could not find matching 'end ${keyword}'`,
        code: 1049,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineAfterExitWhile: () => ({
        message: `Expected newline after 'exit while'`,
        code: 1050,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndForOrNextToTerminateForLoop: () => ({
        message: `Expected 'end for' or 'next' to terminate 'for' loop`,
        code: 1051,
        severity: DiagnosticSeverity.Error
    }),
    expectedInAfterForEach: (name: string) => ({
        message: `Expected 'in' after 'for each ${name}'`,
        code: 1052,
        severity: DiagnosticSeverity.Error
    }),
    expectedExpressionAfterForEachIn: () => ({
        message: `Expected expression after 'in' keyword from 'for each' statement`,
        code: 1053,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineAfterExitFor: () => ({
        message: `Expected newline after 'exit for'`,
        code: 1054,
        severity: DiagnosticSeverity.Error
    }),
    expectedStringLiteralAfterKeyword: (keyword: string) => ({
        message: `Missing string literal after '${keyword}' keyword`,
        code: 1055,
        severity: DiagnosticSeverity.Error
    }),
    keywordMustBeDeclaredAtRootLevel: (keyword: string) => ({
        message: `${keyword} must be declared at the root level`,
        code: 1056,
        severity: DiagnosticSeverity.Error
    }),
    libraryStatementMustBeDeclaredAtTopOfFile: () => ({
        message: `'library' statement must be declared at the top of the file`,
        code: 1057,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndIfElseIfOrElseToTerminateThenBlock: () => ({
        message: `Expected 'end if', 'else if', or 'else' to terminate 'then' block`,
        code: 1058,
        severity: DiagnosticSeverity.Error
    }),
    expectedColonToPreceedEndIf: () => ({
        message: `Expected ':' to preceed 'end if'`,
        code: 1059,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndIfToCloseIfStatement: (startingPosition: Position) => ({
        message: `Expected 'end if' to close 'if' statement started at ${startingPosition?.line + 1}:${startingPosition?.character + 1}`,
        code: 1060,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementToFollowConditionalCondition: (conditionType: string) => ({
        message: `Expected a statement to follow '${conditionType?.toLowerCase()} ...condition... then'`,
        code: 1061,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementToFollowElse: () => ({
        message: `Expected a statement to follow 'else'`,
        code: 1062,
        severity: DiagnosticSeverity.Error
    }),
    consecutiveIncrementDecrementOperatorsAreNotAllowed: () => ({
        message: `Consecutive increment/decrement operators are not allowed`,
        code: 1063,
        severity: DiagnosticSeverity.Error
    }),
    incrementDecrementOperatorsAreNotAllowedAsResultOfFunctionCall: () => ({
        message: ``,
        code: 1064,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColonAfterExpressionStatement: () => ({
        message: `Expected newline or ':' after expression statement`,
        code: 1065,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementOrFunctionCallButReceivedExpression: () => ({
        message: `Expected statement or function call but instead found expression`,
        code: 1066,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColonAfterIndexedSetStatement: () => ({
        message: `Expected newline or ':' after indexed set statement`,
        code: 1067,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColonAfterDottedSetStatement: () => ({
        message: `Expected newline or ':' after dotted set statement`,
        code: 1068,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColonAfterPrintedValues: () => ({
        message: `Expected newline or ':' after printed values`,
        code: 1069,
        severity: DiagnosticSeverity.Error
    }),
    labelsMustBeDeclaredOnTheirOwnLine: () => ({
        message: `Labels must be declared on their own line`,
        code: 1070,
        severity: DiagnosticSeverity.Error
    }),
    expectedLabelIdentifierAfterGotoKeyword: () => ({
        message: `Expected label identifier after 'goto' keyword`,
        code: 1071,
        severity: DiagnosticSeverity.Error
    }),
    expectedRightSquareBraceAfterArrayOrObjectIndex: () => ({
        message: `Expected ']' after array or object index`,
        code: 1072,
        severity: DiagnosticSeverity.Error
    }),
    expectedPropertyNameAfterPeriod: () => ({
        message: `Expected property name after '.'`,
        code: 1073,
        severity: DiagnosticSeverity.Error
    }),
    tooManyCallableArguments: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} arguments but found ${actual}`,
        code: 1074,
        severity: DiagnosticSeverity.Error
    }),
    expectedRightParenAfterFunctionCallArguments: () => ({
        message: `Expected ')' after function call arguments`,
        code: 1075,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftParenAfterExpression: () => ({
        message: `Unmatched '(': expected ')' after expression`,
        code: 1076,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftSquareBraceAfterArrayLiteral: () => ({
        message: `Unmatched '[': expected ']' after array literal`,
        code: 1077,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedAAKey: () => ({
        message: `Expected identifier or string as associative array key`,
        code: 1078,
        severity: DiagnosticSeverity.Error
    }),
    expectedColonBetweenAAKeyAndvalue: () => ({
        message: `Expected ':' between associative array key and value`,
        code: 1079,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftCurlyAfterAALiteral: () => ({
        message: `Unmatched '{': expected '}' after associative array literal`,
        code: 1080,
        severity: DiagnosticSeverity.Error
    }),
    foundUnexpectedToken: (text: string) => ({
        message: `Found unexpected token '${text}'`,
        code: 1081,
        severity: DiagnosticSeverity.Error
    }),
    /**
     * Used in the lexer anytime we encounter an unsupported character
     */
    unexpectedCharacter: (text: string) => ({
        message: `Unexpected character '${text}' (char code ${text?.charCodeAt(0)})`,
        code: 1082,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedStringAtEndOfLine: () => ({
        message: `Unterminated string at end of line`,
        code: 1083,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedStringAtEndOfFile: () => ({
        message: `Unterminated string at end of file`,
        code: 1084,
        severity: DiagnosticSeverity.Error
    }),
    fractionalHexLiteralsAreNotSupported: () => ({
        message: `Fractional hex literals are not supported`,
        code: 1085,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedConditionalCompilationString: () => ({
        message: `Unexpected conditional-compilation string`,
        code: 1086,
        severity: DiagnosticSeverity.Error
    }),
    duplicateConstDeclaration: (name: string) => ({
        message: `Attempting to redeclare #const with name '${name}'`,
        code: 1087,
        severity: DiagnosticSeverity.Error
    }),
    constAliasDoesNotExist: (name: string) => ({
        message: `Attempting to create #const alias of '${name}', but no such #const exists`,
        code: 1088,
        severity: DiagnosticSeverity.Error
    }),
    invalidHashConstValue: () => ({
        message: '#const declarations can only have values of `true`, `false`, or other #const names',
        code: 1089,
        severity: DiagnosticSeverity.Error
    }),
    referencedConstDoesNotExist: () => ({
        message: `Referenced #const does not exist`,
        code: 1090,
        severity: DiagnosticSeverity.Error
    }),
    invalidHashIfValue: () => ({
        message: `#if conditionals can only be 'true', 'false', or other #const names`,
        code: 1091,
        severity: DiagnosticSeverity.Error
    }),
    hashError: (message: string) => ({
        message: `#error ${message}`,
        code: 1092,
        severity: DiagnosticSeverity.Error
    }),
    expectedEqualAfterConstName: () => ({
        message: `Expected '=' after #const`,
        code: 1093,
        severity: DiagnosticSeverity.Error
    }),
    expectedHashElseIfToCloseHashIf: (startingLine: number) => ({
        message: `Expected '#else if' to close '#if' conditional compilation statement starting on line ${startingLine}`,
        code: 1094,
        severity: DiagnosticSeverity.Error
    }),
    constNameCannotBeReservedWord: () => ({
        message: `#const name cannot be a reserved word`,
        code: 1095,
        severity: DiagnosticSeverity.Error
    }),
    expectedIdentifier: () => ({
        message: `Expected identifier`,
        code: 1096,
        severity: DiagnosticSeverity.Error
    }),
    expectedAttributeNameAfterAtSymbol: () => ({
        message: `Expected xml attribute name after '@'`,
        code: 1097,
        severity: DiagnosticSeverity.Error
    }),
    memberAlreadyExistsInParentClass: (memberType: string, parentClassName: string) => ({
        message: `A ${memberType} with this name already exists in inherited class '${parentClassName}'`,
        code: 1098,
        severity: DiagnosticSeverity.Error
    }),
    classChildMemberDifferentMemberTypeThanAncestor: (memberType: string, parentMemberType: string, parentClassName: string) => ({
        message: `Class member is a ${memberType} here but a ${parentMemberType} in ancestor class '${parentClassName}'`,
        code: 1099,
        severity: DiagnosticSeverity.Error
    }),
    classConstructorMissingSuperCall: () => ({
        message: `Missing "super()" call in class constructor method.`,
        code: 1100,
        severity: DiagnosticSeverity.Error
    }),
    classConstructorSuperMustBeFirstStatement: () => ({
        message: `A call to 'super()' must be the first statement in this constructor method.`,
        code: 1101,
        severity: DiagnosticSeverity.Error
    }),
    classFieldCannotBeOverridden: () => ({
        message: `Class field cannot be overridden`,
        code: 1102,
        severity: DiagnosticSeverity.Error
    }),
    autoImportComponentScriptCollision: () => ({
        message: `Component script auto-import found '.bs' and '.brs' files with the same name and will import only the '.bs' file`,
        code: 1103,
        severity: DiagnosticSeverity.Warning
    }),
    localVarShadowedByScopedFunction: () => ({
        message: `Declaring a local variable with same name as scoped function can result in unexpected behavior`,
        code: 1104,
        severity: DiagnosticSeverity.Error
    }),
    scopeFunctionShadowedByBuiltInFunction: () => ({
        message: `Scope function will not be accessible because it has the same name as a built-in function`,
        code: 1105,
        severity: DiagnosticSeverity.Error
    }),
    brighterscriptScriptTagMissingTypeAttribute: () => ({
        message: `All BrighterScript script tags must include the type="text/brighterscript" attribute`,
        code: 1106,
        severity: DiagnosticSeverity.Error
    }),
    unnecessaryCodebehindScriptImport: () => ({
        message: `This import is unnecessary because compiler option 'autoImportComponentScript' is enabled`,
        code: 1107,
        severity: DiagnosticSeverity.Warning
    }),
    expectedOpenParenToFollowCallfuncIdentifier: () => ({
        message: `Expected '(' to follow callfunc identifier`,
        code: 1108,
        severity: DiagnosticSeverity.Error
    }),
    callfuncExpressionMustHaveAtLeastOneArgument: () => ({
        message: `A callfunc expression must have at least one argument`,
        code: 1109,
        severity: DiagnosticSeverity.Error
    }),
    parameterMayNotHaveSameNameAsNamespace: (paramName: string) => ({
        message: `Parameter '${paramName}' may not have the same name as namespace`,
        code: 1110,
        severity: DiagnosticSeverity.Error
    }),
    variableMayNotHaveSameNameAsNamespace: (variableName: string) => ({
        message: `Variable '${variableName}' may not have the same name as namespace`,
        code: 1111,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedTemplateStringAtEndOfFile: () => ({
        message: `Unterminated template string at end of file`,
        code: 1113,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedTemplateExpression: () => ({
        message: `Unterminated template string expression. '\${' must be followed by expression, then '}'`,
        code: 1114,
        severity: DiagnosticSeverity.Error
    }),
    duplicateComponentName: (componentName: string) => ({
        message: `There are multiple components with the name '${componentName}'`,
        code: 1115,
        severity: DiagnosticSeverity.Error
    })

};

let allCodes = [] as number[];
for (let key in DiagnosticMessages) {
    allCodes.push(DiagnosticMessages[key]().code);
}

export let diagnosticCodes = allCodes;

export interface DiagnosticInfo {
    message: string;
    code: number;
    severity: DiagnosticSeverity;
}
