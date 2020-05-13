import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import { standardizePath as s } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import { ParseMode } from './parser/Parser';
import { LogLevel, logger } from './Logger';


describe.only('Scope', () => {
    let sinon = sinonImport.createSandbox();
    let rootDir = process.cwd();
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        // logger.logLevel = LogLevel.debug;
    });
    afterEach(() => {
        sinon.restore();
    });

    it('does not mark namespace functions as collisions with stdlib', async () => {
        await program.addOrReplaceFile({
            src: `${rootDir}/source/main.bs`,
            dest: `source/main.bs`
        }, `
            namespace a
                function constructor()
                end function
            end namespace
        `);

        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', async () => {
            const sourceScope = program.getScopeByName('source');

            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.brs`, dest: s`source/lib.brs` }, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            expect(sourceScope.getFiles().map(x => x.pathAbsolute).sort()).eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
            expect(program.getDiagnostics()).to.be.lengthOf(0);
            expect(sourceScope.getOwnCallables()).is.lengthOf(3);
            expect(sourceScope.getAllCallables()).is.lengthOf(3);
        });

        it('picks up new callables', async () => {
            await program.addOrReplaceFile('source/file.brs', '');
            //we have global callables, so get that initial number
            let originalLength = program.getScopeByName('source').getAllCallables().length;

            await program.addOrReplaceFile('source/file.brs', `
            function DoA()
                print "A"
            end function

             function DoA()
                 print "A"
             end function
        `);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(originalLength + 2);
        });
    });

    describe('removeFile', () => {
        it('removes callables from list', async () => {
            //add the file
            let file = await program.addOrReplaceFile(`source/file.brs`, `
                function DoA()
                    print "A"
                end function
            `);
            let initCallableCount = program.getScopeByName('source').getAllCallables().length;

            //remove the file
            program.removeFile(file.pathAbsolute);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(initCallableCount - 1);
        });
    });

    describe('validate', () => {
        it('marks the scope as validated after validation has occurred', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
               sub main()
               end sub
            `);
            let lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
               sub libFunc()
               end sub
            `);
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;
            await program.validate();
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.true;
            lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
                sub libFunc()
                end sub
            `);

            //scope gets marked as invalidated
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;

        });

        it('does not mark same-named-functions in different namespaces as an error', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameB
                    sub alert()
                    end sub
                end namespace
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });
        it('resolves local-variable function calls', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName()
                end sub`
            );
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });

        describe('function shadowing', () => {
            it('warns when local var function has same name as stdlib function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = function(p)
                            return "override"
                        end function
                        print str(12345) 'prints "12345" (i.e. our local function is never used)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib').message,
                    range: Range.create(2, 24, 2, 27)
                });
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = function()
                            return "override"
                        end function
                        print getHello() 'prints "hello" (i.e. our local variable is never called)
                    end sub
                    
                    function getHello()
                        return "hello"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('scope').message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = "override"
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('detects scope function with same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        print str(12345) ' prints 12345 (i.e. our str() function below is ignored)
                    end sub
                    function str(num)
                        return "override"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction().message,
                    range: Range.create(4, 29, 4, 32)
                });
            });
        });

        it('detects duplicate callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expect(
                program.getDiagnostics().length
            ).to.equal(0);
            //validate the scope
            await program.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(program.getDiagnostics().map(x => x.message).sort()).to.eql([
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message,
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message
            ]);
        });

        it('detects calls to unknown callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
            `);
            expect(program.getDiagnostics().length).to.equal(0);
            //validate the scope
            await program.validate();
            expect(program.getDiagnostics()[0]).to.deep.include({
                code: DiagnosticMessages.callToUnknownFunction('DoB', '').code
            });
        });

        it('recognizes known callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            //validate the scope
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).to.eql([
                DiagnosticMessages.callToUnknownFunction('DoC', 'source').message
            ]);
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', async () => {
            expect(program.getDiagnostics().length).to.equal(0);
            await program.addOrReplaceFile('source/file.brs', `
               function DoB()
                    m.doSomething()
                end function
            `);
            //validate the scope
            await program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });

        it('detects calling functions with too many parameters', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a()
                end sub
                sub b()
                    a(1)
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount(0, 1).message
            );
        });

        it('detects calling functions with too many parameters', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(name)
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).to.includes(
                DiagnosticMessages.mismatchArgumentCount(1, 0).message
            );
        });

        it('allows skipping optional parameter', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('shows expected parameter range in error message', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount('1-2', 0).message
            );
        });

        it('handles expressions as arguments to a function', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a("cat" + "dog" + "mouse")
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('Catches extra arguments for expressions as arguments to a function', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age)
                end sub
                sub b()
                    a(m.lib.movies[0], 1)
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.mismatchArgumentCount(1, 2).message
            );
        });
    });

    describe('inheritance', () => {
        it('inherits callables from parent', async () => {
            program = new Program({ rootDir: rootDir });

            await program.addOrReplaceFile('components/child.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <script uri="child.brs"/>
                </component>
            `);
            await program.addOrReplaceFile(s`components/child.brs`, ``);
            await program.validate();
            let childScope = program.getComponentScope('child');
            expect(childScope.getAllCallables().map(x => x.callable.name)).not.to.include('parentSub');

            await program.addOrReplaceFile('components/parent.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="parent" extends="Scene">
                    <script uri="parent.brs"/>
                </component>
            `);
            await program.addOrReplaceFile(s`components/parent.brs`, `
                sub parentSub()
                end sub
            `);
            await program.validate();

            expect(childScope.getAllCallables().map(x => x.callable.name)).to.include('parentSub');
        });
    });

    describe('detachParent', () => {
        it('does not attach global to itself', () => {
            expect(program.globalScope.getParentScope()).not.to.exist;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            let scope = program.getScopeByName('global');
            expect(scope.getDefinition(file, Position.create(0, 0))).to.be.lengthOf(0);
        });
    });

    describe('getCallablesAsCompletions', () => {
        it('returns documentation when possible', () => {
            let completions = program.globalScope.getCallablesAsCompletions(ParseMode.BrightScript);
            expect(completions.filter(x => !!x.documentation)).to.have.length.greaterThan(0);
        });
    });
});
