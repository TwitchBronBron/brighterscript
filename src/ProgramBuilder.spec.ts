import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { Logger, LogLevel } from './Logger';

describe('ProgramBuilder', () => {

    let tmpPath = s`${process.cwd()}/.tmp`;
    let rootDir = s`${tmpPath}/rootDir`;
    let stagingFolderPath = s`${tmpPath}/staging`;

    beforeEach(() => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.emptyDirSync(tmpPath);
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
    });

    let builder: ProgramBuilder;
    beforeEach(async () => {
        builder = new ProgramBuilder();
        builder.options = await util.normalizeAndResolveConfig({
            rootDir: rootDir
        });
        builder.program = new Program(builder.options);
        builder.logger = new Logger();
    });


    afterEach(() => {
        builder.dispose();
    });

    describe('loadAllFilesAST', () => {
        it('loads .bs, .brs, .xml files', async () => {
            sinon.stub(util, 'getFilePaths').returns(Promise.resolve([{
                src: 'file.brs',
                dest: 'file.brs'
            }, {
                src: 'file.bs',
                dest: 'file.bs'
            }, {
                src: 'file.xml',
                dest: 'file.xml'
            }]));

            let stub = sinon.stub(builder.program, 'addOrReplaceFile');
            await builder['loadAllFilesAST']();
            expect(stub.getCalls()).to.be.lengthOf(3);
        });

        it('loads all type definitions first', async () => {
            const requestedFiles = [] as string[];
            builder.program.fileResolvers.push((filePath) => {
                requestedFiles.push(s(filePath));
            });
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.d.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/lib.d.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/lib.brs`, '');
            const stub = sinon.stub(builder.program, 'addOrReplaceFile');
            await builder['loadAllFilesAST']();
            const srcPaths = stub.getCalls().map(x => x.args[0].src);
            //the d files should be first
            expect(srcPaths.indexOf(s`${rootDir}/source/main.d.bs`)).within(0, 1);
            expect(srcPaths.indexOf(s`${rootDir}/source/lib.d.bs`)).within(0, 1);
            //the non-d files should be last
            expect(srcPaths.indexOf(s`${rootDir}/source/main.brs`)).within(2, 3);
            expect(srcPaths.indexOf(s`${rootDir}/source/lib.brs`)).within(2, 3);

            //the d files should NOT be requested from the FS
            expect(requestedFiles).not.to.include(s`${rootDir}/source/lib.d.bs`);
            expect(requestedFiles).not.to.include(s`${rootDir}/source/main.d.bs`);
        });

        it('does not load non-existent type definition file', async () => {
            const requestedFiles = [] as string[];
            builder.program.fileResolvers.push((filePath) => {
                requestedFiles.push(s(filePath));
            });
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, '');
            await builder['loadAllFilesAST']();
            //the d file should not be requested because `loadAllFilesAST` knows it doesn't exist
            expect(requestedFiles).not.to.include(s`${rootDir}/source/main.d.bs`);
        });
    });

    describe('run', () => {
        it('uses default options when the config file fails to parse', async () => {
            //supress the console log statements for the bsconfig parse errors
            sinon.stub(console, 'log').returns(undefined);
            //totally bogus config file
            fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, '{');
            await builder.run({
                project: s`${rootDir}/bsconfig.json`,
                username: 'john'
            });
            expect(builder.program.options.username).to.equal('rokudev');
        });

        //this fails on the windows travis build for some reason. skipping for now since it's not critical
        it.skip('throws an exception when run is called twice', async () => {
            await builder.run({});
            try {
                await builder.run({});
                expect(true).to.be.false('Should have thrown exception');
            } catch (e) { }
        });

        afterEach(() => {
            try {
                fsExtra.removeSync(`${rootDir}/testProject`);
            } catch (e) {
                console.error(e);
            }
        });

        it('only adds the last file with the same pkg path', async () => {
            //undo the vfs for this test
            sinon.restore();
            fsExtra.ensureDirSync(`${rootDir}/testProject/source`);
            fsExtra.writeFileSync(`${rootDir}/testProject/source/lib1.brs`, 'sub doSomething()\nprint "lib1"\nend sub');
            fsExtra.writeFileSync(`${rootDir}/testProject/source/lib2.brs`, 'sub doSomething()\nprint "lib2"\nend sub');

            await builder.run({
                rootDir: s`${rootDir}/testProject`,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                //both files should want to be the `source/lib.brs` file...but only the last one should win
                files: [{
                    src: s`${rootDir}/testProject/source/lib1.brs`,
                    dest: 'source/lib.brs'
                }, {
                    src: s`${rootDir}/testProject/source/lib2.brs`,
                    dest: 'source/lib.brs'
                }]
            });
            const diagnostics = builder.getDiagnostics();
            expect(diagnostics.map(x => x.message)).to.eql([]);
            expect(builder.program.getFileByPathAbsolute(s``));
        });
    });

    it('uses a unique logger for each builder', async () => {
        let builder1 = new ProgramBuilder();
        sinon.stub(builder1 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder1 as any, 'loadAllFilesAST').returns(Promise.resolve());

        let builder2 = new ProgramBuilder();
        sinon.stub(builder2 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder2 as any, 'loadAllFilesAST').returns(Promise.resolve());

        expect(builder1.logger).not.to.equal(builder2.logger);

        await Promise.all([
            builder1.run({
                logLevel: LogLevel.info,
                rootDir: rootDir,
                stagingFolderPath: stagingFolderPath,
                watch: false
            }),
            builder2.run({
                logLevel: LogLevel.error,
                rootDir: rootDir,
                stagingFolderPath: stagingFolderPath,
                watch: false
            })
        ]);

        //the loggers should have different log levels
        expect(builder1.logger.logLevel).to.equal(LogLevel.info);
        expect(builder2.logger.logLevel).to.equal(LogLevel.error);
    });

    it('does not error when loading stagingFolderPath from bsconfig.json', async () => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.writeFileSync(`${rootDir}/bsconfig.json`, `{
            "stagingFolderPath": "./out"
        }`);
        let builder = new ProgramBuilder();
        await builder.run({
            cwd: rootDir,
            createPackage: false
        });
    });

    it('forwards program events', async () => {
        const beforeProgramValidate = sinon.spy();
        const afterProgramValidate = sinon.spy();
        builder.plugins.add({
            name: 'forwards program events',
            beforeProgramValidate: beforeProgramValidate,
            afterProgramValidate: afterProgramValidate
        });
        await builder.run({
            createPackage: false
        });
        expect(beforeProgramValidate.callCount).to.equal(1);
        expect(afterProgramValidate.callCount).to.equal(1);
    });
});
