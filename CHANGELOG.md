# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [0.10.10]
### Fixed
 - include the missing `bslib.brs` file in the npm package which was causing errors during transpile. 



## [0.10.9]
### Added
 - bslib.brs gets copied to `pkg:/source` and added as an import to every component on transpile.
 - several timing logs under the `"info"` log level.
### Changed
 - pipe the language server output to the extension's log window
### Fixed
 - bug with global `val` function signature that did not support the second parameter ([#110](https://github.com/rokucommunity/vscode-brightscript-language/issues/110))
 - bug with global 'StrI' function signature that did not support the second parameter.



## [0.10.8] - 2020-06-09
### Fixed
 - Allow leading spcaes for `bs:disable-line` and `bs:disable-next-line` comments ([#108](https://github.com/rokucommunity/brighterscript/pull/108))



## [0.10.7] - 2020-06-08
### Fixed
 - bug in cli that was always returning a nonzero error code



## [0.10.6] - 2020-06-05
### Fixed
 - incorrect definition for global `Left()` function. ([#100](https://github.com/rokucommunity/brighterscript/issues/100))
 - missing definition for global `Tab()` and `Pos()` functions ([#101](https://github.com/rokucommunity/brighterscript/issues/101))



## [0.10.5] - 2020-06-04
### Changed
 - added better logging for certain critical language server crashes



## [0.10.4] - 2020-05-28
### Fixed
 - bug where assigning a namespaced function to a variable wasn't properly transpiling the dots to underscores (fixes [#91](https://github.com/rokucommunity/brighterscript/issues/91))
 - flag parameter with same name as namespace
 - flag variable with same name as namespace
 - `CreateObject("roRegex")` with third parameter caused compile error ([#95](https://github.com/rokucommunity/brighterscript/issues/95))



## [0.10.3] - 2020-05-27
### Changed
 - tokenizing a string with no closing quote will now include all of the text until the end of the line.
 - language server `TranspileFile` command now waits until the program is finished building before trying to transpile.



## [0.10.2] - 2020-05-23
### Added 
 - language server command `TranspileFile` which will return the transpiled contents of the requested file. 
### Fixed
 - quotemarks in string literals were not being properly escaped during transpile ([#89](https://github.com/rokucommunity/brighterscript/issues/89))
 - Bug that was only validating calls at top level. Now calls found anywhere in a function are validated



## [0.10.1] - 2020-05-22
### Fixed
 - transpile bug for compound assignment statements (such as `+=`, `-=`) ([#87](https://github.com/rokucommunity/brighterscript/issues/87))
 - transpile bug that was inserting function parameter types before default values ([#88](https://github.com/rokucommunity/brighterscript/issues/88))
 - export BsConfig interface from index.ts to make it easier for NodeJS importing.



## [0.10.0] - 2020-05-19
### Added 
 - new callfunc operator. 



## [0.9.8] - 2020-05-16
### Changed
 - the inner event system handling file changes. This should fix several race conditions causing false negatives during CLI runs.
### Fixed
 - some bugs related to import statements not being properly traced.



## [0.9.7] - 2020-05-14
### Changed
 - TypeScript target to "ES2017" which provides a significant performance boost in lexer (~30%) and parser (~175%)
### Fixed
 - the binary name got accidentally renamed to `bsc2` in release 0.9.6. This release fixes that issue.
 - removed some debug logs that were showing up when not using logLevel=debug
 - false negative diagnostic when using the `new` keyword as a local variable [#79](https://github.com/rokucommunity/brighterscript/issues/79)



## [0.9.6] - 2020-05-11
### Added
 - `logLevel` option from the bsconfig.json and command prompt that allows specifying how much detain the logging should contain.
 - additional messages during cli run
### Changed
 - don't terminate bsc on warning diagnostics
 - removed extraneous log statements from the util module 
### Fixed
 - fixed bugs when printing diagnostics to the console that wouldn't show the proper squiggly line location.



## [0.9.5] - 2020-05-06
### Added
 - new config option called `showDiagnosticsInConsole` which disables printing diagnostics to the console 
### Fixed
 - bug in lexer that was capturing the carriage return character (`\n`) at the end of comment statements
 - bug in transpiler that wouldn't include a newline after the final comment statement
 - bug in LanguageServer that was printing diagnostics to the console when it shouldn't be.



## [0.9.4] - 2020-05-05
### Added
 - diagnostic for detecting unnecessary script imports when `autoImportComponentScript` is enabled
### Changed
 - filter duplicate dignostics from multiple projects. ([#75](https://github.com/rokucommunity/brighterscript/issues/75))
### Fixed
 - bug that was flagging namespaced functions with the same name as a stdlib function.
 - bug that was not properly transpiling brighterscript script tags in xml components.
 - several performance issues introduced in v0.8.2. 
 - Replace `type="text/brighterscript"` with `type="text/brightscript"` in xml script imports during transpile. ([#73](https://github.com/rokucommunity/brighterscript/issues/73))



## [0.9.3] - 2020-05-04
### Changed
 - do not show BRS1013 for standalone files ([#72](https://github.com/rokucommunity/brighterscript/issues/72))
 - BS1011 (same name as global function) is no longer shown for local variables that are not of type `function` ([#70](https://github.com/rokucommunity/brighterscript/issues/70))
### Fixed
 - issue that prevented certain keywords from being used as function parameter names ([#69](https://github.com/rokucommunity/brighterscript/issues/69))



## [0.9.2] - 2020-05-02
### Changed
 - intellisense anywhere other than next to a dot now includes keywords (#67)

### Fixed
 - bug in the lexer that was not treating `constructor` as an identifier (#66)
 - bug when printing diagnostics that would sometimes fail to find the line in question (#68)
 - bug in scopes that were setting isValidated=false at the end of the `validate()` call instead of true



## [0.9.1] - 2020-05-01
### Fixed
 - bug with upper-case two-word conditional compile tokens (`#ELSE IF` and `#END IF`) (#63)



## [0.9.0] - 2020-05-01
### Added
 - new compile flag `autoImportComponentScript` which will automatically import a script for a component with the same name if it exists.



## [0.8.2] - 2020-04-29
### Fixed
 - bugs in namespace transpilation
 - bugs in class transpilation
 - transpiled examples for namespace and class docs
 - bugs in class property initialization



## [0.8.1] - 2020-04-27
### Fixed
 - Bug where class property initializers would cause parse error
 - better parse recovery for incomplete class members



## [0.8.0] - 2020-04-26
### Added
 - new `import` syntax for BrighterScript projects.
 - experimental transpile support for xml files (converts `.bs` extensions to `.brs`, auto-appends the `import` statments to each xml component)
### Changed
 - upgraded to vscode-languageserver@6.1.1


## [0.7.2] - 2020-04-24
### Fixed
 - runtime bug in the language server when validating incomplete class statements



## [0.7.1] - 2020-04-23
### Fixed
 - dependency issue: `glob` is required but was not listed as a dependency



## [0.7.0] - 2020-04-23
### Added
 - basic support for namespaces
 - experimental parser support for import statements (no transpile yet)
### Changed
 - parser produces TokenKind.Library now instead of an identifier token for library.



## [0.6.0] 2020-04-15
### Added
 - ability to filter out diagnostics by using the `diagnosticFilters` option in bsconfig
### Changed
 - depricated the `ignoreErrorCodes` in favor of `diagnosticFilters`
### Fixed
 - Bug in the language server that wasn't reloading the project when changing the `bsconfig.json`



## [0.5.4] 2020-04-13
### Fixed
 - Syntax bug that wasn't allowing period before indexed get expression (example: `prop.["key"]`) (#58)
 - Syntax bug preventing comments from being used in various locations within a class



## [0.5.3] - 2020-04-12
### Added
 - syntax support for the xml attribute operator (`node@someAttr`) (#34)
 - syntax support for bitshift operators (`<<` and `>>`) (#50)
 - several extra validation checks for class statements
### Fixed
 - syntax bug that was showing parse errors for known global method names (such as `string()`) (#49)



## [0.5.2] - 2020-04-11
### Changed
 - downgrade diagnostic issue 1007 from an error to a warning, and updated the message to "Component is mising "extends" attribute and will automatically extend "Group" by default" (#53)
### Fixed
 - Prevent xml files found outside of the `pkg:/components` folder from being parsed and validated. (#51)
 - allow empty `elseif` and `else` blocks. (#48)



## [0.5.1] - 2020-04-10
### Changed
 - upgraded to [roku-deploy@3.0.2](https://www.npmjs.com/package/roku-debug/v/0.3.4) which fixed a file copy bug in subdirectories of symlinked folders (fixes #41)



## [0.5.0] - 2020-04-10
### Added
 - several new diagnostics for conditional compiles. Some of them allow the parser to recover and continue. 
 - experimental class transpile support. There is still no intellisense for classes yet though.
### Changed
   - All errors are now stored as vscode-languageserver `Diagnostic` objects instead of a custom error structure.
   - Token, AST node, and diagnostic locations are now stored as `Range` objects, which use zero-based lines instead of the previous one-based line numbers. 
   - All parser diagnostics have been broken out into their own error codes, removing the use of error code 1000 for a generic catch-all. That code still exists and will hold runtime errors from the parser.
### Fixed
 - bug in parser that was flagging the new class keywords (`new`, `class`, `public`, `protected`, `private`, `override`) as parse errors. These are now allowed as both local variables and property names.



## [0.4.4] - 2020-04-04
### Fixed
 - bug in the ProgramBuilder that would terminate the program on first run if an error diagnostic was found, even when in watch mode.



## [0.4.3] - 2020-04-03
### Changed
 - the `bsc` cli now emits a nonzero return code whenever parse errors are encountered, which allows tools to detect compile-time errors. (#43)



## [0.4.2] - 2020-04-01
### Changed
 - upgraded to [roku-deploy@3.0.0](https://www.npmjs.com/package/roku-deploy/v/3.0.0)



## [0.4.1] - 2020-01-11
### Changed
 - upgraded to [roku-deploy@3.0.0-beta.7](https://www.npmjs.com/package/roku-deploy/v/3.0.0-beta.7) which fixed a critical bug during pkg creation.



## [0.4.0] - 2020-01-07
### Added 
 - ability to specify the pkgPath of a file when adding to the project. 
### Changed
 - upgraded to [roku-deploy@3.0.0-beta.6](https://www.npmjs.com/package/roku-deploy/v/3.0.0-beta.6)
### Fixed
 - bug that was showing duplicate function warnings when multiple files target the same `pkgPath`. Now roku-deploy will only keep the last referenced file for each `pkgPath`
 - reduced memory consumtion and FS calls during file watcher events
 - issue in getFileByPkgPath related to path separator mismatches
 - bugs related to standalone workspaces causing issues for other workspaces. 



## [0.3.1] - 2019-11-08
### Fixed
 - language server bug that was showing error messages in certain startup race conditions.
 - error during hover caused by race condition during file re-parse.



## [0.3.0] - 2019-10-03
### Added
 - support for parsing opened files not included in any project. 
### Fixed
 - parser bug that was preventing comments as their own lines inside associative array literals. ([#29](https://github.com/rokucommunity/brighterscript/issues/28))



## [0.2.2] - 2019-09-27
### Fixed
 - bug in language server where the server would crash when sending a diagnostic too early. Now the server waits for the program to load before sending diagnostics.



## [0.2.1] - 2019-09-24
### Changed
 - the text for diagnostic 1010 to say "override" instead of "shadows"
### Fixed
 - crash when parsing the workspace path to read the config on startup.
 - auto complete options not always returning results when it should.
 - windows bug relating to the drive letter being different, and so then not matching the file list. 
 - many bugs related to mismatched file path comparisons.



## [0.2.0] - 2019-09-20
### Added
 - bsconfig.json validation
 - slightly smarter intellisense that knows when you're trying to complete an object property.
 - diagnostic for depricated brsconfig.json
 - basic transpile support including sourcemaps. Most lines also support transpiling including comments, but there may still be bugs
 - parser now includes all comments as tokens in the AST.

### Fixed
 - bugs in the languageserver intellisense
 - parser bug that would fail when a line ended with a period
 - prevent intellisense when typing inside a comment
 - Bug during file creation that wouldn't recognize the file


## [0.1.0] - 2019-08-10
### Changed
 - Cloned from [brightscript-language](https://github.com/rokucommunity/brightscript-language)



[0.10.10]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.9...v0.10.10
[0.10.9]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.8...v0.10.9
[0.10.7]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.6...v0.10.7
[0.10.6]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.5...v0.10.6
[0.10.5]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.4...v0.10.5
[0.10.4]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.3...v0.10.4
[0.10.3]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.2...v0.10.3
[0.10.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.1...v0.10.2
[0.10.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.0...v0.10.1
[0.10.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.9.8...v0.10.0
[0.9.8]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.7...v0.9.8
[0.9.7]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.6...v0.9.7
[0.9.6]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.5...v0.9.6
[0.9.5]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.4...v0.9.5
[0.9.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.3...v0.9.4
[0.9.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.2...v0.9.3
[0.9.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.1...v0.9.2
[0.9.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.0...v0.9.1
[0.9.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.8.2...v0.9.0
[0.8.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.8.1...v0.8.2
[0.8.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.8.0...v0.8.1
[0.8.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.7.2...v0.8.0
[0.7.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.7.1...v0.7.2
[0.7.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.7.0...v0.7.1
[0.7.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.6.0...v0.7.0
[0.6.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.5.4...v0.6.0
[0.5.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.5.3...v0.5.4
[0.5.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.5.2...v0.5.3
[0.5.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.5.1...v0.5.2
[0.5.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.5.0...v0.5.1
[0.5.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.4.4...v0.5.0
[0.4.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.4.3...v0.4.4
[0.4.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.4.2...v0.4.3
[0.4.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.4.1...v0.4.2
[0.4.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.4.0...v0.4.1
[0.4.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.3.1...v0.4.0
[0.3.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.3.0...v0.3.1
[0.3.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.2.2...v0.3.0
[0.2.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.2.1...v0.2.2
[0.2.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.2.0...v0.2.1
[0.2.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.2.0
[0.1.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.1.0
