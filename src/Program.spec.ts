import { assert, expect } from 'chai';
import * as pick from 'object.pick';
import * as sinonImport from 'sinon';
import { CompletionItemKind, Position, Range, DiagnosticSeverity, Location } from 'vscode-languageserver';
import * as fsExtra from 'fs-extra';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import { standardizePath as s, util } from './util';
import { URI } from 'vscode-uri';
import PluginInterface from './PluginInterface';
import type { FunctionStatement } from './parser/Statement';
import { EmptyStatement } from './parser/Statement';
import { trim, trimMap } from './testHelpers.spec';

let sinon = sinonImport.createSandbox();
let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe.only('Program', () => {
    let program: Program;
    beforeEach(() => {
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingFolderPath
        });
        program.createSourceScope(); //ensure source scope is created
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program.dispose();
    });

    describe('global scope', () => {
        it('returns all callables when asked', () => {
            expect(program.globalScope.getAllCallables().length).to.be.greaterThan(0);
        });
        it('validate gets called and does nothing', () => {
            expect(program.globalScope.validate()).to.eql(undefined);
        });
    });

    describe('addFile', () => {
        it('adds various files to `pkgMap`', async () => {
            await program.addOrReplaceFile('source/main.brs', '');
            expect(program['pkgMap']).to.have.property(s`source/main.brs`);

            await program.addOrReplaceFile('source/main.bs', '');
            expect(program['pkgMap']).to.have.property(s`source/main.bs`);

            await program.addOrReplaceFile('components/comp1.xml', '');
            expect(program['pkgMap']).to.have.property(s`components/comp1.xml`);
        });

        it('does not crash when given a totally bogus file', async () => {
            await program.addOrReplaceFile({
                src: `${rootDir}/source/main.brs`,
                dest: 'source/main.brs'
            }, `class Animalpublic name as stringpublic function walk()end functionend class`);
            //if the program didn't get stuck in an infinite loop, this test passes
        });
        describe('fileResolvers', () => {
            it('loads brs file contents from disk when necessary', async () => {
                let stub = sinon.stub(util, 'getFileContents').returns(Promise.resolve(''));
                expect(stub.called).to.be.false;

                //resolve lib.brs from memory instead of going to disk
                program.fileResolvers.push((pathAbsolute) => {
                    if (
                        pathAbsolute === s`${rootDir}/source/lib.brs` ||
                        pathAbsolute === s`${rootDir}/source/lib.d.bs`
                    ) {
                        return `'comment`;
                    }
                });
                await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' });

                expect(stub.called).to.be.false;

                //load main.brs from disk
                await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' });
                expect(stub.called).to.be.true;
            });

            it('loads xml file contents from disk when necessary', async () => {
                let stub = sinon.stub(util, 'getFileContents').returns(Promise.resolve(''));
                expect(stub.called).to.be.false;

                program.fileResolvers.push((pathAbsolute) => {
                    if (pathAbsolute === s`${rootDir}/components/A.xml`) {
                        return `<?xml version="1.0" encoding="utf-8" ?>`;
                    }
                });
                await program.addOrReplaceFile({ src: `${rootDir}/components/A.xml`, dest: 'components/A.xml' });
                expect(stub.called).to.be.false;

                await program.addOrReplaceFile({ src: `${rootDir}/components/B.brs`, dest: 'components/B.brs' });
                expect(stub.called).to.be.true;

            });
        });

        it('only parses xml files as components when file is found within the "components" folder', async () => {
            expect(Object.keys(program.files).length).to.equal(0);

            await program.addOrReplaceFile({
                src: s`${rootDir}/components/comp1.xml`,
                dest: util.pathSepNormalize(`components/comp1.xml`)
            }, '');
            expect(Object.keys(program.files).length).to.equal(1);

            await program.addOrReplaceFile({
                src: s`${rootDir}/notComponents/comp1.xml`,
                dest: util.pathSepNormalize(`notComponents/comp1.xml`)
            }, '');
            expect(Object.keys(program.files).length).to.equal(1);

            await program.addOrReplaceFile({
                src: s`${rootDir}/componentsExtra/comp1.xml`,
                dest: util.pathSepNormalize(`componentsExtra/comp1.xml`)
            }, '');
            expect(Object.keys(program.files).length).to.equal(1);
        });

        it('supports empty statements for transpile', async () => {
            const file = await program.addOrReplaceFile<BrsFile>('source/main.bs', `
                sub main()
                    m.logError()
                    'some comment
                end sub
            `);
            (file.parser.ast.statements[0] as FunctionStatement).func.body.statements[0] = new EmptyStatement();
            await program.transpile([{ src: file.pathAbsolute, dest: file.pkgPath }], tmpPath);
        });

        it('works with different cwd', async () => {
            let projectDir = s`${tmpPath}/project2`;
            fsExtra.ensureDirSync(projectDir);
            program = new Program({ cwd: projectDir });
            await program.addOrReplaceFile({ src: 'source/lib.brs', dest: 'source/lib.brs' }, 'function main()\n    print "hello world"\nend function');
            // await program.reloadFile('source/lib.brs', `'this is a comment`);
            //if we made it to here, nothing exploded, so the test passes
        });

        it(`adds files in the source folder to the 'source' scope`, async () => {
            expect(program.getScopeByName('source')).to.exist;
            //no files in source scope
            expect(program.getScopeByName('source').getOwnFiles().length).to.equal(0);

            let mainPath = s`${rootDir}/source/main.brs`;
            //add a new source file
            await program.addOrReplaceFile({ src: mainPath, dest: 'source/main.brs' }, '');
            //file should be in source scope now
            expect(program.getScopeByName('source').getFile(mainPath)).to.exist;

            //add an unreferenced file from the components folder
            await program.addOrReplaceFile({ src: `${rootDir}/components/component1/component1.brs`, dest: 'components/component1/component1.brs' }, '');

            //source scope should have the same number of files
            expect(program.getScopeByName('source').getFile(mainPath)).to.exist;
            expect(program.getScopeByName('source').getFile(`${rootDir}/components/component1/component1.brs`)).not.to.exist;
        });

        it('normalizes file paths', async () => {
            let filePath = `${rootDir}/source\\main.brs`;
            await program.addOrReplaceFile({ src: filePath, dest: 'source/main.brs' }, '');

            expect(program.getScopeByName('source').getFile(filePath)).to.exist;

            //shouldn't throw an exception because it will find the correct path after normalizing the above path and remove it
            try {
                program.removeFile(filePath);
                //no error
            } catch (e) {
                assert.fail(null, null, 'Should not have thrown exception');
            }
        });

        it('creates a scope for every component xml file', () => {
            // let componentPath = path.resolve(`${rootDir}/components/component1.xml`);
            // await program.loadOrReloadFile('components', '')
        });

        it(`emits events for scope and file creation`, async () => {
            const beforeProgramValidate = sinon.spy();
            const afterProgramValidate = sinon.spy();
            const afterScopeCreate = sinon.spy();
            const beforeScopeValidate = sinon.spy();
            const afterScopeValidate = sinon.spy();
            const beforeFileParse = sinon.spy();
            const afterFileParse = sinon.spy();
            const afterFileValidate = sinon.spy();
            program.plugins = new PluginInterface([{
                name: 'emits events for scope and file creation',
                beforeProgramValidate: beforeProgramValidate,
                afterProgramValidate: afterProgramValidate,
                afterScopeCreate: afterScopeCreate,
                beforeScopeValidate: beforeScopeValidate,
                afterScopeValidate: afterScopeValidate,
                beforeFileParse: beforeFileParse,
                afterFileParse: afterFileParse,
                afterFileValidate: afterFileValidate
            }], undefined);

            let mainPath = s`${rootDir}/source/main.brs`;
            //add a new source file
            await program.addOrReplaceFile({ src: mainPath, dest: 'source/main.brs' }, '');
            //add a component file
            await program.addOrReplaceFile({ src: `${rootDir}/components/component1.xml`, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>`);
            await program.validate();

            //program events
            expect(beforeProgramValidate.callCount).to.equal(1);
            expect(afterProgramValidate.callCount).to.equal(1);
            //scope events
            //(we get component scope event only because source is created in beforeEach)
            expect(afterScopeCreate.callCount).to.equal(1);
            expect(beforeScopeValidate.callCount).to.equal(2);
            expect(afterScopeValidate.callCount).to.equal(2);
            //file events
            expect(beforeFileParse.callCount).to.equal(2);
            expect(afterFileParse.callCount).to.equal(2);
            expect(afterFileValidate.callCount).to.equal(2);
        });
    });

    describe('validate', () => {
        it('catches duplicate XML component names', async () => {
            //add 2 components which both reference the same errored file
            await program.addOrReplaceFile({ src: `${rootDir}/components/component1.xml`, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/components/component2.xml`, dest: 'components/component2.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            await program.validate();
            expect(program.getDiagnostics()).to.be.lengthOf(2);
            expect(program.getDiagnostics().map(x => {
                delete x.file;
                return x;
            })).to.eql([{
                ...DiagnosticMessages.duplicateComponentName('Component1'),
                range: Range.create(1, 17, 1, 27),
                relatedInformation: [{
                    location: Location.create(
                        URI.file(s`${rootDir}/components/component1.xml`).toString(),
                        Range.create(1, 17, 1, 27)
                    ),
                    message: 'Also defined here'
                }]
            }, {
                ...DiagnosticMessages.duplicateComponentName('Component1'),
                range: Range.create(1, 17, 1, 27),
                relatedInformation: [{
                    location: Location.create(
                        URI.file(s`${rootDir}/components/component2.xml`).toString(),
                        Range.create(1, 17, 1, 27)
                    ),
                    message: 'Also defined here'
                }]
            }]);
        });

        it('allows adding diagnostics', () => {
            const expected = [{
                message: 'message',
                file: undefined,
                range: undefined
            }];
            program.addDiagnostics(expected);
            const actual = (program as any).diagnostics;
            expect(actual).to.deep.equal(expected);
        });

        it('does not produce duplicate parse errors for different component scopes', async () => {
            //add a file with a parse error
            await program.addOrReplaceFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, `
                sub DoSomething()
                    'random out-of-place open paren, definitely causes parse error
                    (
                end sub
            `);

            //add 2 components which both reference the same errored file
            await program.addOrReplaceFile({ src: `${rootDir}/components/component1.xml`, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/components/component2.xml`, dest: 'components/component2.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component2" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>
            `);

            await program.validate();

            let diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
        });

        it('detects scripts not loaded by any file', async () => {
            //add a main file for sanity check
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            await program.validate();
            expect(program.getDiagnostics()).to.be.lengthOf(0);

            //add the orphaned file
            await program.addOrReplaceFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, '');
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].code).to.equal(DiagnosticMessages.fileNotReferencedByAnyOtherFile().code);
        });
        it('does not throw errors on shadowed init functions in components', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/lib.brs`, dest: 'lib.brs' }, `
                function DoSomething()
                    return true
                end function
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/Parent.xml`, dest: 'components/Parent.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Parent" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/Child.xml`, dest: 'components/Child.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child" extends="Parent">
                </component>
            `);

            await program.validate();
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });

        it('recognizes global function calls', async () => {
            expect(program.getDiagnostics().length).to.equal(0);
            await program.addOrReplaceFile({ src: `${rootDir}/source/file.brs`, dest: 'source/file.brs' }, `
                function DoB()
                    sleep(100)
                end function
            `);
            //validate the scope
            await program.validate();
            let diagnostics = program.getDiagnostics();
            //shouldn't have any errors
            expect(diagnostics).to.be.lengthOf(0);
        });

        it('shows warning when a child component imports the same script as its parent', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/parent.xml`, dest: 'components/parent.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/lib.brs`, dest: 'lib.brs' }, `'comment`);
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].code).to.equal(DiagnosticMessages.unnecessaryScriptImportInChildFromParent('').code);
            expect(diagnostics[0].severity).to.equal(DiagnosticSeverity.Warning);
        });

        it('adds info diag when child component method shadows parent component method', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/parent.xml`, dest: 'components/parent.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/parent.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/child.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/parent.brs`, dest: 'parent.brs' }, `sub DoSomething()\nend sub`);
            await program.addOrReplaceFile({ src: `${rootDir}/child.brs`, dest: 'child.brs' }, `sub DoSomething()\nend sub`);
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].code).to.equal(DiagnosticMessages.overridesAncestorFunction('', '', '', '').code);
        });

        it('does not add info diagnostic on shadowed "init" functions', async () => {
            await program.addOrReplaceFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="parent.brs" />
                </component>
                `);
            await program.addOrReplaceFile(`components/parent.brs`, `sub Init()\nend sub`);
            await program.addOrReplaceFile(`components/child.brs`, `sub Init()\nend sub`);

            await program.addOrReplaceFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="child.brs" />
                </component>
            `);
            //run this validate separately so we can have an easier time debugging just the child component
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics.map(x => x.message)).to.eql([]);
        });

        it('catches duplicate methods in single file', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(2);
            expect(program.getDiagnostics()[0].message.indexOf('Duplicate sub declaration'));
        });

        it('catches duplicate methods across multiple files', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub DoSomething()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(2);
            expect(program.getDiagnostics()[0].message.indexOf('Duplicate sub declaration'));
        });

        it('maintains correct callables list', async () => {
            let initialCallableCount = program.getScopeByName('source').getAllCallables().length;
            await program.addOrReplaceFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount + 2);
            //set the file contents again (resetting the wasProcessed flag)
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
                `);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount + 2);
            program.removeFile(`${rootDir}/source/main.brs`);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount);
        });

        it('resets errors on revalidate', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(2);
            //set the file contents again (resetting the wasProcessed flag)
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(2);

            //load in a valid file, the errors should go to zero
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('identifies invocation of unknown function', async () => {
            //call a function that doesn't exist
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    name = "Hello"
                    DoSomething(name)
                end sub
            `);

            await program.validate();
            expect(program.getDiagnostics().length).to.equal(1);
            expect(program.getDiagnostics()[0].code).to.equal(DiagnosticMessages.callToUnknownFunction('', '').code);
        });

        it('detects methods from another file in a subdirectory', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    DoSomething()
                end sub
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/source/ui/lib.brs`, dest: 'source/ui/lib.brs' }, `
                function DoSomething()
                    print "hello world"
                end function
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(0);
        });
    });

    describe('hasFile', () => {
        it('recognizes when it has a file loaded', async () => {
            expect(program.hasFile('file1.brs')).to.be.false;
            await program.addOrReplaceFile({ src: 'file1.brs', dest: 'file1.brs' }, `'comment`);
            expect(program.hasFile('file1.brs')).to.be.true;
        });
    });

    describe('addOrReplaceFile', () => {
        it('links xml scopes based on xml parent-child relationships', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ChildScene.xml`, dest: 'components/ChildScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                </component>
            `);

            expect(program.getScopeByName('components/ChildScene.xml').getParentScope().name).to.equal(s`components/ParentScene.xml`);

            //change the parent's name.
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="NotParentScene" extends="Scene">
                </component>
            `);

            //The child scope should no longer have the link to the parent scope, and should instead point back to global
            expect(program.getScopeByName('components/ChildScene.xml').getParentScope().name).to.equal('global');
        });

        it('creates a new scope for every added component xml', async () => {
            //we have global callables, so get that initial number
            await program.addOrReplaceFile({ src: `${rootDir}/components/component1.xml`, dest: 'components/component1.xml' }, '');
            expect(program.getScopeByName(`components/component1.xml`)).to.exist;

            await program.addOrReplaceFile({ src: `${rootDir}/components/component1.xml`, dest: 'components/component1.xml' }, '');
            await program.addOrReplaceFile({ src: `${rootDir}/components/component2.xml`, dest: 'components/component2.xml' }, '');
            expect(program.getScopeByName(`components/component1.xml`)).to.exist;
            expect(program.getScopeByName(`components/component2.xml`)).to.exist;
        });

        it('includes referenced files in xml scopes', async () => {
            let xmlPath = s`${rootDir}/components/component1.xml`;
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            let brsPath = s`${rootDir}/components/component1.brs`;
            await program.addOrReplaceFile({ src: brsPath, dest: 'components/component1.brs' }, '');

            let scope = program.getScopeByName(`components/component1.xml`);
            expect(scope.getFile(xmlPath).pkgPath).to.equal(s`components/component1.xml`);
            expect(scope.getFile(brsPath).pkgPath).to.equal(s`components/component1.brs`);
        });

        it('adds xml file to files map', async () => {
            let xmlPath = `${rootDir}/components/component1.xml`;
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, '');
            expect(program.getFileByPathAbsolute(xmlPath)).to.exist;
        });

        it('detects missing script reference', async () => {
            let xmlPath = `${rootDir}/components/component1.xml`;
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics.length).to.equal(1);
            expect(diagnostics[0]).to.deep.include(<BsDiagnostic>{
                ...DiagnosticMessages.referencedFileDoesNotExist(),
                file: program.getFileByPathAbsolute(xmlPath),
                range: Range.create(2, 42, 2, 72)
            });
        });

        it('adds warning instead of error on mismatched upper/lower case script import', async () => {
            await program.addOrReplaceFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="component1.brs" />
                </component>
            `);
            await program.addOrReplaceFile('components/COMPONENT1.brs', '');

            //validate
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics.map(x => x.message)).to.eql([
                DiagnosticMessages.scriptImportCaseMismatch(s`components\\COMPONENT1.brs`).message
            ]);
        });
    });

    describe('reloadFile', () => {
        it('picks up new files in a scope when an xml file is loaded', async () => {
            program.options.ignoreErrorCodes.push(1013);
            let xmlPath = s`${rootDir}/components/component1.xml`;
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/comonent1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]).to.deep.include(<BsDiagnostic>{
                message: DiagnosticMessages.referencedFileDoesNotExist().message
            });

            //add the file, the error should go away
            let brsPath = s`${rootDir}/components/component1.brs`;
            await program.addOrReplaceFile({ src: brsPath, dest: 'components/component1.brs' }, '');
            await program.validate();
            expect(program.getDiagnostics()).to.be.empty;

            //add the xml file back in, but change the component brs file name. Should have an error again
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component2.brs" />
                </component>
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]).to.deep.include(<BsDiagnostic>{
                message: DiagnosticMessages.referencedFileDoesNotExist().message
            });
        });

        it('handles when the brs file is added before the component', async () => {
            let brsPath = s`${rootDir}/components/component1.brs`;
            await program.addOrReplaceFile({ src: brsPath, dest: 'components/component1.brs' }, '');

            let xmlPath = s`${rootDir}/components/component1.xml`;
            let xmlFile = await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            await program.validate();
            expect(program.getDiagnostics()).to.be.empty;
            expect(program.getScopeByName(xmlFile.pkgPath).getFile(brsPath)).to.exist;
        });

        it('reloads referenced fles when xml file changes', async () => {
            program.options.ignoreErrorCodes.push(1013);
            let brsPath = s`${rootDir}/components/component1.brs`;
            await program.addOrReplaceFile({ src: brsPath, dest: 'components/component1.brs' }, '');

            let xmlPath = s`${rootDir}/components/component1.xml`;
            let xmlFile = await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">

                </component>
            `);
            await program.validate();
            expect(program.getDiagnostics()).to.be.empty;
            expect(program.getScopeByName(xmlFile.pkgPath).getFile(brsPath)).not.to.exist;

            //reload the xml file contents, adding a new script reference.
            xmlFile = await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);

            expect(program.getScopeByName(xmlFile.pkgPath).getFile(brsPath)).to.exist;

        });
    });

    describe('getCompletions', () => {
        it('should include first-level namespace names for brighterscript files', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
                sub main()

                end sub
            `);
            let completions = (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(6, 23))).map(x => x.label);
            expect(completions).to.include('NameA');
            expect(completions).not.to.include('NameB');
            expect(completions).not.to.include('NameA.NameB');
            expect(completions).not.to.include('NameA.NameB.NameC');
            expect(completions).not.to.include('NameA.NameB.NameC.DoSomething');
        });

        it('resolves completions for namespaces with next namespace part for brighterscript file', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
                sub main()
                    NameA.
                end sub
            `);
            let completions = (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(6, 26))).map(x => x.label);
            expect(completions).to.include('NameB');
            expect(completions).not.to.include('NameA');
            expect(completions).not.to.include('NameA.NameB');
            expect(completions).not.to.include('NameA.NameB.NameC');
            expect(completions).not.to.include('NameA.NameB.NameC.DoSomething');
        });

        it('finds namespace members for brighterscript file', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                sub main()
                    NameA.
                    NameA.NameB.
                    NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 26))).map(x => x.label).sort()
            ).to.eql(['NameB', 'alertA', 'info']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 32))).map(x => x.label).sort()
            ).to.eql(['NameC', 'alertB']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 38))).map(x => x.label).sort()
            ).to.eql(['alertC']);
        });

        it('finds namespace members for classes', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                sub main()
                    NameA.
                    NameA.NameB.
                    NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                    class MyClassA
                    end class
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                    end class
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 26))).map(x => x.label).sort()
            ).to.eql(['MyClassA', 'NameB', 'alertA', 'info']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 32))).map(x => x.label).sort()
            ).to.eql(['MyClassB', 'NameC', 'alertB']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 38))).map(x => x.label).sort()
            ).to.eql(['alertC']);
        });

        it('finds only namespaces that have classes, when new keyword is used', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                sub main()
                    a = new NameA.
                    b = new NameA.NameB.
                    c = new NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                    class MyClassA
                    end class
                end namespace
                namespace NameA.NameB
                namespace NameA.NoClassA
                end namespace
                namespace NameA.NoClassB
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                    end class
                end namespace
                namespace NameA.NameB.NoClass
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 34))).map(x => x.label).sort()
            ).to.eql(['MyClassA', 'NameB']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 40))).map(x => x.label).sort()
            ).to.eql(['MyClassB']);

            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 46))).map(x => x.label).sort()
            ).to.be.empty;
        });

        //Bron.. pain to get this working.. do we realy need this? seems moot with ropm..
        it.skip('should include translated namespace function names for brightscript files', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub test()

                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/lib.brs`, Position.create(2, 23));
            expect(completions.map(x => x.label)).to.include('NameA_NameB_NameC_DoSomething');
        });

        it('inlcudes global completions for file with no scope', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'main.brs' }, `
                function Main()
                    age = 1
                end function
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label.toLowerCase() === 'abs')).to.be.lengthOf(1);
        });

        it('filters out text results for top-level function statements', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                function Main()
                    age = 1
                end function
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'Main')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties used in conditional statements', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    p.
                end sub
                sub SayHello()
                    person = {}
                    if person.isAlive then
                        print "Hello"
                    end if
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'isAlive')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties used in assignments', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    p.
                end sub
                sub SayHello()
                   person = {}
                   localVar = person.name
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'name')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    p.
                end sub
                sub SayHello()
                   person = {}
                   person.name = "bob"
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'name')).to.be.lengthOf(1);
        });

        it('filters out text results for local vars used in conditional statements', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub
                sub SayHello()
                    isTrue = true
                    if isTrue then
                        print "is true"
                    end if
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'isTrue')).to.be.lengthOf(0);
        });

        it('filters out text results for local variable assignments', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub
                sub SayHello()
                    message = "Hello"
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'message')).to.be.lengthOf(0);
        });

        it('filters out text results for local variables used in assignments', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub
                sub SayHello()
                    message = "Hello"
                    otherVar = message
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'message')).to.be.lengthOf(0);
        });

        it('does not suggest local variables when initiated to the right of a period', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                function Main()
                    helloMessage = "jack"
                    person.hello
                end function
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 32));
            expect(completions.filter(x => x.kind === CompletionItemKind.Variable).map(x => x.label)).not.to.contain('helloMessage');
        });

        it('finds all file paths when initiated on xml uri', async () => {
            let xmlPath = s`${rootDir}/components/component1.xml`;
            await program.addOrReplaceFile({ src: xmlPath, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `);
            let brsPath = s`${rootDir}/components/component1.brs`;
            await program.addOrReplaceFile({ src: brsPath, dest: 'components/component1.brs' }, '');
            let completions = await program.getCompletions(xmlPath, Position.create(2, 42));
            expect(completions[0]).to.include({
                kind: CompletionItemKind.File,
                label: 'component1.brs'
            });
            expect(completions[1]).to.include({
                kind: CompletionItemKind.File,
                label: 'pkg:/components/component1.brs'
            });
            //it should NOT include the global methods
            expect(completions).to.be.lengthOf(2);
        });

        it('get all functions and properties in scope when doing any dotted get on non m ', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                sub main()
                    thing.anonPropA = "foo"
                    thing.anonPropB = "bar"
                    thing.person
                end sub
                class MyClassA
                    personName = "rafa"
                    personAName = "rafaA"
                    function personAMethodA()
                    end function
                    function personAMethodB()
                    end function
                end class
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                        personName = "roger"
                        personBName = "rogerB"
                        function personAMethodC()
                        end function
                        function personBMethodA()
                        end function
                        function personBMethodB()
                        end function
                    end class
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            //note - we let the vscode extension do the filtering, so we still return everything; otherwise it exhibits strange behaviour in the IDE
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 32))).map(x => x.label).sort()
            ).to.eql(['anonPropA', 'anonPropB', 'person', 'personAMethodA', 'personAMethodB', 'personAMethodC', 'personAName', 'personBMethodA', 'personBMethodB', 'personBName', 'personName']);
        });

        it('get all functions and properties relevant for m ', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                class MyClassA
                    function new()
                        m.
                    end function
                    personName = "rafa"
                    personAName = "rafaA"
                    function personAMethodA()
                    end function
                    function personAMethodB()
                    end function
                end class
                class MyClassB
                    personName = "roger"
                    personBName = "rogerB"
                    function personAMethodC()
                    end function
                    function personBMethodA()
                    end function
                    function personBMethodB()
                    end function
                end class
                class MyClassC extends MyClassA
                    function new()
                        m.
                    end function
                    personCName = "rogerC"
                    function personCMethodC()
                    end function
                    function personCMethodA()
                    end function
                    function personCMethodB()
                    end function
                end class
                sub alertC()
                end sub
            `);
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 26))).map(x => x.label).sort()
            ).to.eql(['personAMethodA', 'personAMethodB', 'personAName', 'personName']);
            expect(
                (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(24, 26))).map(x => x.label).sort()
            ).to.eql(['personAMethodA', 'personAMethodB', 'personAName', 'personCMethodA', 'personCMethodB', 'personCMethodC', 'personCName', 'personName']);
        });

    });

    it('include non-namespaced classes in the list of general output', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                function regularFunc()
                    MyClass
                end function
                sub alertC()
                end sub
                class MyClassA
                end class
                class MyClassB
                end class
                class MyClassC extends MyClassA
                end class
            `);
        expect(
            (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 26))).map(x => x.label).sort()
        ).to.include.members(['MyClassA', 'MyClassB', 'MyClassC']);
    });

    it('only include classes when using new keyword', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.brs' }, `
                class MyClassA
                end class
                class MyClassB
                end class
                class MyClassC extends MyClassA
                end class
                function regularFunc()
                    new MyClass
                end function
                sub alertC()
                end sub
            `);
        expect(
            (await program.getCompletions(`${rootDir}/source/main.bs`, Position.create(8, 29))).map(x => x.label).sort()
        ).to.eql(['MyClassA', 'MyClassB', 'MyClassC']);
    });

    describe('xml inheritance', () => {
        it('handles parent-child attach and detach', async () => {
            //create parent component
            let parentFile = await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            let childFile = await program.addOrReplaceFile({ src: s`${rootDir}/components/ChildScene.xml`, dest: 'components/ChildScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                </component>
            `);

            //the child should have been attached to the parent
            expect((childFile as XmlFile).parentComponent).to.equal(parentFile);

            //change the name of the parent
            parentFile = await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="NotParentScene" extends="Scene">
                </component>
            `);

            //the child should no longer have a parent
            expect((childFile as XmlFile).parentComponent).not.to.exist;
        });

        it('provides child components with parent functions', async () => {
            //create parent component
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ChildScene.xml`, dest: 'components/ChildScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/components/ChildScene.brs`, dest: 'components/ChildScene.brs' }, `
                sub Init()
                    DoParentThing()
                end sub
            `);

            await program.validate();

            //there should be an error when calling DoParentThing, since it doesn't exist on child or parent
            expect(program.getDiagnostics()).to.be.lengthOf(1);
            expect(program.getDiagnostics()[0]).to.deep.include(<BsDiagnostic>{
                code: DiagnosticMessages.callToUnknownFunction('DoParentThing', '').code
            });

            //add the script into the parent
            await program.addOrReplaceFile({ src: s`${rootDir}/components/ParentScene.xml`, dest: 'components/ParentScene.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="ParentScene.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/ParentScene.brs`, dest: 'components/ParentScene.brs' }, `
                sub DoParentThing()

                end sub
            `);

            await program.validate();
            //the error should be gone because the child now has access to the parent script
            expect(program.getDiagnostics()).to.be.empty;
        });
    });

    describe('xml scope', () => {
        it('does not fail on base components with many children', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub DoSomething()
                end sub
            `);

            //add a brs file with invalid syntax
            await program.addOrReplaceFile({ src: `${rootDir}/components/base.xml`, dest: 'components/base.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="BaseScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            let childCount = 20;
            //add many children, we should never encounter an error
            for (let i = 0; i < childCount; i++) {
                await program.addOrReplaceFile({ src: `${rootDir}/components/child${i}.xml`, dest: `components/child${i}.xml` }, trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Child${i}" extends="BaseScene">
                        <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                    </component>
                `);
            }
            await program.validate();
            let diagnostics = program.getDiagnostics();

            //the children shouldn't have diagnostics about shadowing their parent lib.brs file.
            let shadowedDiagnositcs = diagnostics.filter((x) => x.code === DiagnosticMessages.overridesAncestorFunction('', '', '', '').code);
            expect(shadowedDiagnositcs).to.be.lengthOf(0);

            //the children all include a redundant import of lib.brs file which is imported by the parent.
            let importDiagnositcs = diagnostics.filter((x) => x.code === DiagnosticMessages.unnecessaryScriptImportInChildFromParent('').code);
            expect(importDiagnositcs).to.be.lengthOf(childCount);
        });

        it('detects script import changes', async () => {
            //create the xml file without script imports
            let xmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/component.xml`, dest: 'components/component.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                </component>
            `);

            //the component scope should only have the xml file
            expect(program.getScopeByName(xmlFile.pkgPath).getOwnFiles().length).to.equal(1);

            //create the lib file
            let libFile = await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `'comment`);

            //change the xml file to have a script import
            xmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/component.xml`, dest: 'components/component.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            let ctx = program.getScopeByName(xmlFile.pkgPath);
            //the component scope should have the xml file AND the lib file
            expect(ctx.getOwnFiles().length).to.equal(2);
            expect(ctx.getFile(xmlFile.pathAbsolute)).to.exist;
            expect(ctx.getFile(libFile.pathAbsolute)).to.exist;

            //reload the xml file again, removing the script import.
            xmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/component.xml`, dest: 'components/component.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                </component>
            `);

            //the scope should again only have the xml file loaded
            expect(program.getScopeByName(xmlFile.pkgPath).getOwnFiles().length).to.equal(1);
            expect(program.getScopeByName(xmlFile.pkgPath)).to.exist;
        });
    });

    describe('getFileByPkgPath', () => {
        it('finds file in source folder', async () => {
            expect(program.getFileByPkgPath(s`source/main.brs`)).not.to.exist;
            expect(program.getFileByPkgPath(s`source/main2.brs`)).not.to.exist;
            await program.addOrReplaceFile({ src: `${rootDir}/source/main2.brs`, dest: 'source/main2.brs' }, '');
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            expect(program.getFileByPkgPath(s`source/main.brs`)).to.exist;
            expect(program.getFileByPkgPath(s`source/main2.brs`)).to.exist;
        });
    });

    describe('removeFiles', () => {
        it('removes files by absolute paths', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            expect(program.getFileByPkgPath(s`source/main.brs`)).to.exist;
            program.removeFiles([`${rootDir}/source/main.brs`]);
            expect(program.getFileByPkgPath(s`source/main.brs`)).not.to.exist;
        });
    });

    describe('addOrReplaceFiles', () => {
        it('adds multiple files', async () => {
            expect(Object.keys(program.files).length).to.equal(0);
            let brsFilePath = s`${rootDir}/components/comp1.brs`.toLowerCase();
            let xmlFilePath = s`${rootDir}/components/comp1.xml`.toLowerCase();
            program.fileResolvers.push((filePath) => {
                if (filePath.toLowerCase() === s`${brsFilePath}`) {
                    return `'${filePath}`;
                } else if (filePath.toLowerCase() === s`${xmlFilePath}`) {
                    return `<!--${filePath}`;
                }
            });
            await program.addOrReplaceFiles([
                { src: brsFilePath, dest: 'components/comp1.brs' },
                { src: xmlFilePath, dest: 'components/comp1.xml' }
            ]);
            expect(Object.keys(program.files).length).to.equal(2);
        });
    });

    describe('getDiagnostics', () => {
        it('includes diagnostics from files not included in any scope', async () => {
            let pathAbsolute = s`${rootDir}/components/a/b/c/main.brs`;
            await program.addOrReplaceFile({ src: pathAbsolute, dest: 'components/a/b/c/main.brs' }, `
                sub A()
                    "this string is not terminated
                end sub
            `);
            //the file should be included in the program
            expect(program.getFileByPathAbsolute(pathAbsolute)).to.exist;
            let diagnostics = program.getDiagnostics();
            expect(diagnostics.length).to.be.greaterThan(0);
            let parseError = diagnostics.filter(x => x.message === 'Unterminated string at end of line')[0];
            expect(parseError).to.exist;
        });

        it('it excludes specified error codes', async () => {
            //declare file with two different syntax errors
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub A()
                    'call with wrong param count
                    B(1,2,3)

                    'call unknown function
                    C()
                end sub

                sub B(name as string)
                end sub
            `);

            await program.validate();
            expect(program.getDiagnostics()).to.be.lengthOf(2);

            program.options.diagnosticFilters = [
                DiagnosticMessages.mismatchArgumentCount(0, 0).code
            ];

            expect(program.getDiagnostics()).to.be.lengthOf(1);
            expect(program.getDiagnostics()[0].code).to.equal(DiagnosticMessages.callToUnknownFunction('', '').code);
        });
    });

    describe('getCompletions', () => {
        it('returns all functions in scope', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            let completions = (await program
                //get completions
                .getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10)))
                //only keep the label property for this test
                .map(x => pick(x, 'label'));

            expect(completions).to.deep.include({ label: 'Main' });
            expect(completions).to.deep.include({ label: 'ActionA' });
            expect(completions).to.deep.include({ label: 'ActionB' });
        });

        it('returns all variables in scope', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    name = "bob"
                    age = 20
                    shoeSize = 12.5
                end sub
                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            let labels = completions.map(x => pick(x, 'label'));

            expect(labels).to.deep.include({ label: 'Main' });
            expect(labels).to.deep.include({ label: 'ActionA' });
            expect(labels).to.deep.include({ label: 'ActionB' });
            expect(labels).to.deep.include({ label: 'name' });
            expect(labels).to.deep.include({ label: 'age' });
            expect(labels).to.deep.include({ label: 'shoeSize' });
        });

        it('returns empty set when out of range', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            expect(program.getCompletions(`${rootDir}/source/main.brs`, Position.create(99, 99))).to.be.empty;
        });

        it('finds parameters', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end sub
            `);
            let completions = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            let labels = completions.map(x => pick(x, 'label'));

            expect(labels).to.deep.include({ label: 'count' });
        });
    });

    it('does not create map by default', async () => {
        fsExtra.ensureDirSync(program.options.stagingFolderPath);
        await program.addOrReplaceFile('source/main.brs', `
            sub main()
            end sub
        `);
        await program.validate();
        await program.transpile([], program.options.stagingFolderPath);
        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/main.brs`)).is.true;
        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/main.brs.map`)).is.false;
    });

    it('creates sourcemap for brs and xml files', async () => {
        fsExtra.ensureDirSync(program.options.stagingFolderPath);
        await program.addOrReplaceFile('source/main.brs', `
            sub main()
            end sub
        `);
        await program.addOrReplaceFile('components/comp1.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
            </component>
        `);
        await program.validate();

        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/main.brs.map`)).is.false;
        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/components/comp1.xml.map`)).is.false;

        let filePaths = [{
            src: s`${rootDir}/source/main.brs`,
            dest: s`source/main.brs`
        }, {
            src: s`${rootDir}/components/comp1.xml`,
            dest: s`components/comp1.xml`
        }];
        program.options.sourceMap = true;
        await program.transpile(filePaths, program.options.stagingFolderPath);

        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/main.brs.map`)).is.true;
        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/components/comp1.xml.map`)).is.true;
    });

    it('copies the bslib.brs file', async () => {
        fsExtra.ensureDirSync(program.options.stagingFolderPath);
        await program.validate();

        await program.transpile([], program.options.stagingFolderPath);

        expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/bslib.brs`)).is.true;
    });

    describe('transpile', () => {
        it('transpiles in-memory-only files', async () => {
            await program.addOrReplaceFile('source/logger.bs', trim`
                sub logInfo()
                    print SOURCE_LINE_NUM
                end sub
            `);
            await program.transpile([], program.options.stagingFolderPath);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingFolderPath}/source/logger.brs`).toString()
            ) + '\n').to.eql(trim`
                sub logInfo()
                    print 2
                end sub
            `);
        });

        it('copies in-memory-only .brs files to stagingDir', async () => {
            await program.addOrReplaceFile('source/logger.brs', trim`
                sub logInfo()
                    print "logInfo"
                end sub
            `);
            await program.transpile([], program.options.stagingFolderPath);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingFolderPath}/source/logger.brs`).toString()
            )).to.eql(trim`
                sub logInfo()
                    print "logInfo"
                end sub
            `);
        });

        it('copies in-memory .xml file', async () => {
            await program.addOrReplaceFile('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            await program.transpile([], program.options.stagingFolderPath);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingFolderPath}/components/Component1.xml`).toString()
            )).to.eql(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `);
        });

        it('uses sourceRoot when provided for brs files', async () => {
            let sourceRoot = s`${tmpPath}/sourceRootFolder`;
            program = new Program({
                rootDir: rootDir,
                stagingFolderPath: stagingFolderPath,
                sourceRoot: sourceRoot,
                sourceMap: true
            });
            await program.addOrReplaceFile('source/main.brs', `
                sub main()
                end sub
            `);
            await program.transpile([{
                src: s`${rootDir}/source/main.brs`,
                dest: s`source/main.brs`
            }], stagingFolderPath);

            let contents = fsExtra.readFileSync(s`${stagingFolderPath}/source/main.brs.map`).toString();
            let map = JSON.parse(contents);
            expect(
                s`${map.sources[0]}`
            ).to.eql(
                s`${sourceRoot}/source/main.brs`
            );
        });

        it('uses sourceRoot when provided for bs files', async () => {
            let sourceRoot = s`${tmpPath}/sourceRootFolder`;
            program = new Program({
                rootDir: rootDir,
                stagingFolderPath: stagingFolderPath,
                sourceRoot: sourceRoot,
                sourceMap: true
            });
            await program.addOrReplaceFile('source/main.bs', `
                sub main()
                end sub
            `);
            await program.transpile([{
                src: s`${rootDir}/source/main.bs`,
                dest: s`source/main.bs`
            }], stagingFolderPath);

            let contents = fsExtra.readFileSync(s`${stagingFolderPath}/source/main.brs.map`).toString();
            let map = JSON.parse(contents);
            expect(
                s`${map.sources[0]}`
            ).to.eql(
                s`${sourceRoot}/source/main.bs`
            );
        });
    });

    describe('typedef', () => {
        describe('emitDefinitions', () => {
            it('generates typedef for .bs files', async () => {
                await program.addOrReplaceFile<BrsFile>('source/Duck.bs', `
                    class Duck
                    end class
                `);
                program.options.emitDefinitions = true;
                await program.validate();
                await program.transpile([], stagingFolderPath);

                expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/Duck.brs`)).to.be.true;
                expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/Duck.d.bs`)).to.be.true;
                expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/Duck.d.brs`)).to.be.false;
            });

            it('does not generate typedef for typedef file', async () => {
                await program.addOrReplaceFile<BrsFile>('source/Duck.d.bs', `
                    class Duck
                    end class
                `);
                program.options.emitDefinitions = true;
                await program.validate();
                await program.transpile([], stagingFolderPath);

                expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/Duck.d.brs`)).to.be.false;
                expect(fsExtra.pathExistsSync(s`${stagingFolderPath}/source/Duck.brs`)).to.be.false;
            });
        });

        it('ignores bs1018 for d.bs files', async () => {
            await program.addOrReplaceFile<BrsFile>('source/main.d.bs', `
                class Duck
                    sub new(name as string)
                    end sub
                    name as string
                end class

                class BabyDuck extends Duck
                    sub new(name as string, age as integer)
                    end sub
                    age as integer
                end class
            `);
            await program.validate();
            expect(program.getDiagnostics()).to.be.empty;
        });
    });

    describe('getSignatureHelp', () => {
        it('gets signature help for constructor with no args', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p = new Person()
                end function

                class Person
                    function new()
                    end function

                    function sayHello()
                    end function
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 31)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('Person()');
        });

        it('gets signature help for class function on dotted get with params', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p.sayHello("there")
                end function

                class Person
                    function new()
                    end function

                    function sayHello(text)
                    end function
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 32)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');

            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 34)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');

            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 27)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');

            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 23)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');
        });

        it('gets signature help for namespaced class function', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    person.sayHello("there")
                end function
                namespace player
                    class Person
                        function new()
                        end function

                        function sayHello(text)
                        end function
                    end class
                end namespace
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 40)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');

            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 30)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text)');
        });

        it('gets signature help for namespace function', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    person.sayHello("hey", "you")
                end function

                namespace person
                    function sayHello(text, text2)
                    end function
                end namespace
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 36)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text, text2)');
        });

        it('gets signature help for nested namespace function', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    person.roger.sayHello("hi", "there")
                end function

                namespace person.roger
                ' comment 1
                ' comment 2

                'comment 3
                'comment 4
                    function sayHello(text, text2)
                    end function
                end namespace
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 41)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text, text2)');
        });

        it('gets signature help for callfunc method', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    myNode@.sayHello(arg1)
                end function
            `);
            await program.addOrReplaceFile('components/MyNode.bs', `
                function sayHello(text, text2)
                end function
            `);
            await program.addOrReplaceFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                    <interface>
                        <function name="sayHello"/>
                    </interface>
                </component>`);
            await program.validate();

            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 36)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function sayHello(text, text2)');
        });

        it('does not get signature help for callfunc method, referenced by dot', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    myNode.sayHello(arg1)
                end function
            `);
            await program.addOrReplaceFile('components/MyNode.bs', `
                function sayHello(text, text2)
                end function
            `);
            await program.addOrReplaceFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                    <interface>
                        <function name="sayHello"/>
                    </interface>
                </component>`);
            await program.validate();

            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 36)));
            expect(program.getDiagnostics()).to.be.empty;
            //note - callfunc completions and signatures are not yet correctly identifying methods that are exposed in an interace - waiting on the new xml branch for that
            expect(signatureHelp).to.be.empty;
        });

        it('gets signature help for constructor with args', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p = new Person(arg1, arg2)
                end function

                class Person
                    function new(arg1, arg2)
                    end function
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 34)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('Person(arg1, arg2)');
        });

        it('gets signature help for constructor with args, defined in super class', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p = new Roger(arg1, arg2)
                end function

                class Person
                    function new(arg1, arg2)
                    end function
                end class
                class Roger extends Person
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 34)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('Roger(arg1, arg2)');
        });

        it('identifies arg index', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p = new Person(arg1, arg2)
                end function

                class Person
                    function new(arg1, arg2)
                    end function
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 34)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].index).to.equal(0);

            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 40)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].index).to.equal(1);
        });

        it('gets signature help for namespaced constructor with args', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p = new people.coders.Person(arg1, arg2)
                end function
                namespace people.coders
                    class Person
                        function new(arg1, arg2)
                        end function
                    end class
                end namespace
                    `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 47)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('people.coders.Person(arg1, arg2)');
            expect(signatureHelp[0].index).to.equal(0);
        });

        it('gets signature help for regular method call', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    test(arg1, a2)
                end function
                function test(arg1, arg2)
                end function
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 27)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function test(arg1, arg2)');
            expect(signatureHelp[0].index).to.equal(0);
            signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 32)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function test(arg1, arg2)');
            expect(signatureHelp[0].index).to.equal(1);
        });

        it('gets signature help for dotted method call, with method in in-scope class', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    p.test(arg1)
                end function
                class Person
                    function new(arg1, arg2)
                    end function
                    function test(arg)
                    end function
                end class
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 25)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function test(arg)');
        });

        it('gets signature help for namespaced method call', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    Person.test(arg1)
                end function
                namespace Person
                    function test(arg)
                    end function
                end namespace
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 31)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function test(arg)');
        });

        it('gets signature help for namespaced method call', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    Person.roger.test(arg1)
                end function
                namespace Person.roger
                    function test(arg)
                    end function
                end namespace
            `);
            let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, 38)));
            expect(program.getDiagnostics()).to.be.empty;
            expect(signatureHelp[0].signature.label).to.equal('function test(arg)');
        });

        it('gets signature help for regular method call on various index points', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    test(a1, a2, a3)
                end function
                function test(arg1, arg2, arg3)
                end function
            `);
            for (let col = 21; col < 27; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(0);
            }
            for (let col = 27; col < 31; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(1);
            }
            for (let col = 31; col < 35; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(2);
            }
        });

        it('gets signature help for callfunc method call on various index points', async () => {
            await program.addOrReplaceFile('components/MyNode.bs', `
                function test(arg1, arg2, arg3)
                end function
            `);
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    thing@.test(a1, a2, a3)
                end function
            `);

            await program.addOrReplaceFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                    <interface>
                        <function name="test"/>
                    </interface>
                </component>`);
            await program.validate();

            for (let col = 29; col < 34; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(0);
            }
            for (let col = 34; col < 38; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(1);
            }
            for (let col = 38; col < 41; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(2);
            }
        });

        it('gets signature help for constructor method call on various index points', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    a = new Person(a1, a2, a3)
                end function
                class Person
                    function new(arg1, arg2, arg3)
                    end function
                end class
            `);
            for (let col = 29; col < 37; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(0);
            }
            for (let col = 37; col < 41; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(1);
            }
            for (let col = 41; col < 45; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(2);
            }
        });

        it('gets signature help for partially typed line', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                function main()
                    thing@.test(a1, a2,
                end function
                function test(arg1, arg2, arg3)
                end function
                `);
            await program.addOrReplaceFile('components/MyNode.bs', `
                function test(arg1, arg2, arg3)
                end function
                `);
            await program.addOrReplaceFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
            <component name="Component1" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                <interface>
                    <function name="test"/>
                </interface>
            </component>`);
            await program.validate();

            for (let col = 28; col < 34; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(0);
            }
            for (let col = 35; col < 38; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(1);
            }
            for (let col = 38; col < 42; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(2);
            }
        });


    });
});
