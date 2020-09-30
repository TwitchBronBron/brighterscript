import { expect } from 'chai';
import * as path from 'path';
import { createSandbox } from 'sinon';
let sinon = createSandbox();
import util, { standardizePath as s } from './util';
import { Range } from 'vscode-languageserver';
import { Lexer } from './lexer';
import { BsConfig } from './BsConfig';
import * as fsExtra from 'fs-extra';

//shorthand for normalizing a path
let n = path.normalize;
let cwd = process.cwd();
let rootConfigPath = s`${process.cwd()}/bsconfig.json`;
let rootConfigDir = path.dirname(rootConfigPath);
let tempDir = s`${process.cwd()}/.tmp`;
let vfs = {};

function addFile(filePath: string, fileContents?: string) {
    let absFilePath = s`${path.resolve(tempDir, filePath)}`;
    vfs[absFilePath] = fileContents || '';
    return absFilePath;
}

describe.only('util', () => {
    beforeEach(() => {
        vfs = {};
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        sinon.stub(util, 'getFileContents').callsFake((filePath) => {
            if (vfs[filePath]) {
                return vfs[filePath];
            } else {
                throw new Error('Cannot find file ' + filePath);
            }
        });
    });

    afterEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
        //restore current working directory
        process.chdir(cwd);
    });

    describe('fileExists', () => {
        it('returns false when no value is passed', async () => {
            expect(await util.fileExists(undefined)).to.be.false;
        });
    });

    describe('uriToPath', () => {
        it('retains original drive casing for windows', () => {
            expect(util.uriToPath(`file:///C:${path.sep}something`)).to.equal(`C:${path.sep}something`);
            expect(util.uriToPath(`file:///c:${path.sep}something`)).to.equal(`c:${path.sep}something`);
        });
    });

    describe('getRokuPkgPath', () => {
        it('replaces more than one windows slash in a path', () => {
            expect(util.getRokuPkgPath('source\\folder1\\folder2\\file.brs')).to.eql('pkg:/source/folder1/folder2/file.brs');
        });
    });

    describe('loadConfigFile', () => {
        it('returns undefined when no path is provided', async () => {
            expect(await util.loadConfigFile(undefined)).to.be.undefined;
        });

        it('returns undefined when the path does not exist', async () => {
            expect(await util.loadConfigFile(`?${cwd}/donotexist.json`)).to.be.undefined;
        });

        it('returns proper list of ancestor project paths', async () => {
            vfs[n(`${cwd}/child.json`)] = `{"extends": "parent.json"}`;
            vfs[n(`${cwd}/parent.json`)] = `{"extends": "grandparent.json"}`;
            vfs[n(`${cwd}/grandparent.json`)] = `{"extends": "greatgrandparent.json"}`;
            vfs[n(`${cwd}/greatgrandparent.json`)] = `{}`;
            let config = await util.loadConfigFile('child.json');
            expect(config._ancestors).to.eql([n(`${cwd}/child.json`), n(`${cwd}/parent.json`), n(`${cwd}/grandparent.json`), n(`${cwd}/greatgrandparent.json`)]);
        });

        it('returns empty ancestors list for non-extends files', async () => {
            vfs[n(`${cwd}/child.json`)] = `{}`;
            let config = await util.loadConfigFile('child.json');
            expect(config._ancestors).to.eql([n(`${cwd}/child.json`)]);
        });

        it('resolves plugins path relatively to config file', () => {
            const config: BsConfig = {
                plugins: [
                    './plugins.js',
                    './scripts/plugins.js',
                    '../scripts/plugins.js',
                    'bsplugin'
                ]
            };
            util.resolvePluginPaths(config, `${cwd}/config/child.json`);
            expect(config.plugins.map(p => (p ? util.pathSepNormalize(p, '/') : undefined))).to.deep.equal([
                `${cwd}/config/plugins.js`,
                `${cwd}/config/scripts/plugins.js`,
                `${cwd}/scripts/plugins.js`,
                'bsplugin'
            ].map(p => util.pathSepNormalize(p, '/')));
        });

        it('removes duplicate plugins and undefined values', () => {
            const config: BsConfig = {
                plugins: [
                    './plugins.js',
                    'bsplugin',
                    '../config/plugins.js',
                    'bsplugin',
                    undefined
                ]
            };
            util.resolvePluginPaths(config, `${cwd}/config/child.json`);
            expect(config.plugins.map(p => (p ? util.pathSepNormalize(p, '/') : undefined))).to.deep.equal([
                `${cwd}/config/plugins.js`,
                'bsplugin'
            ].map(p => util.pathSepNormalize(p, '/')));
        });
    });

    describe('getConfigFilePath', () => {
        it('returns undefined when it does not find the file', async () => {
            let configFilePath = await util.getConfigFilePath(s`${process.cwd()}/testProject/project1`);
            expect(configFilePath).not.to.exist;
        });

        it('returns path to file when found', async () => {
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, '');
            expect(
                await util.getConfigFilePath(s`${tempDir}/rootDir`)
            ).to.equal(
                s`${tempDir}/rootDir/bsconfig.json`
            );
        });

        it('finds config file in parent directory', async () => {
            const bsconfigPath = s`${tempDir}/rootDir/bsconfig.json`;
            fsExtra.outputFileSync(bsconfigPath, '');
            fsExtra.ensureDirSync(`${tempDir}/rootDir/source`);
            expect(
                await util.getConfigFilePath(s`${tempDir}/rootDir/source`)
            ).to.equal(
                s`${tempDir}/rootDir/bsconfig.json`
            );
        });

        it('uses cwd when not provided', async () => {
            //sanity check
            expect(await util.getConfigFilePath()).not.to.exist;

            const rootDir = s`${tempDir}/rootDir`;

            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');

            fsExtra.ensureDirSync(rootDir);
            process.chdir(rootDir);
            try {
                expect(
                    await util.getConfigFilePath()
                ).to.equal(
                    s`${rootDir}/bsconfig.json`
                );
            } finally {
                process.chdir(cwd);
            }
        });
    });

    describe('pathSepNormalize', () => {
        it('works for both types of separators', () => {
            expect(util.pathSepNormalize('c:/some\\path', '\\')).to.equal('c:\\some\\path');
            expect(util.pathSepNormalize('c:/some\\path', '/')).to.equal('c:/some/path');
        });
        it('does not throw when given `undefined`', () => {
            expect(undefined).to.be.undefined;
        });
    });

    describe('lowerDrivePath', () => {
        it('forces drive letters to lower case', () => {
            //unix slashes
            expect(util.driveLetterToLower('C:/projects')).to.equal('c:/projects');
            //windows slashes
            expect(util.driveLetterToLower('C:\\projects')).to.equal(('c:\\projects'));
        });
    });

    describe('findClosestConfigFile', () => {
        beforeEach(() => {
            sinon.stub(util, 'fileExists').callsFake(async (filePath) => {
                return Promise.resolve(
                    Object.keys(vfs).includes(filePath)
                );
            });
        });

        it('finds config up the chain', async () => {
            let brsFilePath = addFile('src/app.brs');
            let currentDirBsConfigPath = addFile('src/bsconfig.json');
            let currentDirBrsConfigPath = addFile('src/brsconfig.json');
            let parentDirBsConfigPath = addFile('bsconfig.json');
            let parentDirBrsConfigPath = addFile('brsconfig.json');

            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBsConfigPath);
            delete vfs[currentDirBsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBrsConfigPath);
            delete vfs[currentDirBrsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBsConfigPath);
            delete vfs[parentDirBsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBrsConfigPath);
        });

    });

    describe('normalizeAndResolveConfig', () => {
        it('throws for missing project file', async () => {
            await expectThrowAsync(async () => {
                await util.normalizeAndResolveConfig({ project: 'path/does/not/exist/bsconfig.json' });
            });
        });

        it('does not throw for optional missing', async () => {
            await expectNotThrowAsync(async () => {
                await util.normalizeAndResolveConfig({ project: '?path/does/not/exist/bsconfig.json' });

            });
        });

        it('throws for missing extends file', async () => {
            vfs[rootConfigPath] = `{ "extends": "path/does/not/exist/bsconfig.json" }`;
            await expectThrowAsync(async () => {
                await util.normalizeAndResolveConfig({
                    project: rootConfigPath
                });
            });
        });

        it('throws for missing extends file', async () => {
            vfs[rootConfigPath] = `{ "extends": "?path/does/not/exist/bsconfig.json" }`;
            await expectNotThrowAsync(async () => {
                await util.normalizeAndResolveConfig({
                    project: rootConfigPath
                });
            });
        });
    });

    describe('normalizeConfig', () => {
        it('loads project from disc', async () => {
            sinon.restore();
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{ "outFile": "customOutDir/pkg.zip" }`);
            let config = await util.normalizeAndResolveConfig({
                project: s`${tempDir}/rootDir/bsconfig.json`
            });
            expect(
                config.outFile
            ).to.equal(
                s`${tempDir}/rootDir/customOutDir/pkg.zip`
            );
        });

        it('loads project from disc and extends it', async () => {
            sinon.restore();
            //the extends file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.base.json`, `{
                "outFile": "customOutDir/pkg1.zip",
                "rootDir": "core"
            }`);

            //the project file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{
                "extends": "bsconfig.base.json",
                "watch": true
            }`);

            let config = await util.normalizeAndResolveConfig({ project: s`${tempDir}/rootDir/bsconfig.json` });

            expect(config.outFile).to.equal(s`${tempDir}/rootDir/customOutDir/pkg1.zip`);
            expect(config.rootDir).to.equal(s`${tempDir}/rootDir/core`);
            expect(config.watch).to.equal(true);
        });

        it('overrides parent files array with child files array', async () => {
            sinon.restore();
            //the parent file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.parent.json`, `{
                "files": ["base.brs"]
            }`);

            //the project file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{
                "extends": "bsconfig.parent.json",
                "files": ["child.brs"]
            }`);

            let config = await util.normalizeAndResolveConfig({ project: s`${tempDir}/rootDir/bsconfig.json` });

            expect(config.files).to.eql(['child.brs']);
        });

        it('catches circular dependencies', async () => {
            vfs[rootConfigPath] = `{
                "extends": "bsconfig2.json"
            }`;
            vfs[path.join(rootConfigDir, 'bsconfig2.json')] = `{
                "extends": "bsconfig.json"
            }`;

            let threw = false;
            try {
                await util.normalizeAndResolveConfig({ project: rootConfigPath });
            } catch (e) {
                threw = true;
            }
            expect(threw).to.equal(true, 'Should have thrown an error');
            //the test passed
        });

        it('properly handles default for watch', async () => {
            let config = await util.normalizeAndResolveConfig({ watch: true });
            expect(config.watch).to.be.true;
        });
    });

    describe('areArraysEqual', () => {
        it('finds equal arrays', () => {
            expect(util.areArraysEqual([1, 2], [1, 2])).to.be.true;
            expect(util.areArraysEqual(['cat', 'dog'], ['cat', 'dog'])).to.be.true;
        });
        it('detects non-equal arrays', () => {
            expect(util.areArraysEqual([1, 2], [1])).to.be.false;
            expect(util.areArraysEqual([1, 2], [2])).to.be.false;
            expect(util.areArraysEqual([2], [1])).to.be.false;
            expect(util.areArraysEqual([2], [0])).to.be.false;
            expect(util.areArraysEqual(['cat', 'dog'], ['cat', 'dog', 'mouse'])).to.be.false;
            expect(util.areArraysEqual(['cat', 'dog'], ['dog', 'cat'])).to.be.false;
        });
    });

    describe('stringFormat', () => {
        it('handles out-of-order replacements', () => {
            expect(util.stringFormat('{1}{0}', 'b', 'a')).to.equal('ab');
        });

        it('does not fail on arguments not provided', () => {
            expect(util.stringFormat('{0}{1}', 'a')).to.equal('a{1}');
        });

    });

    describe('getPkgPathFromTarget', () => {
        it('works with both types of separators', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', '../lib.brs')).to.equal('lib.brs');
            expect(util.getPkgPathFromTarget('components\\component1.xml', '../lib.brs')).to.equal('lib.brs');
        });

        it('resolves single dot directory', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', './lib.brs')).to.equal(n(`components/lib.brs`));
        });

        it('resolves absolute pkg paths as relative paths', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/source/lib.brs')).to.equal(n(`source/lib.brs`));
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/lib.brs')).to.equal(`lib.brs`);
        });

        it('resolves gracefully for invalid values', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg')).to.equal(n(`components/pkg`));
        });
    });

    describe('getRelativePath', () => {
        it('works when both files are at the root', () => {
            expect(util.getRelativePath('file.xml', 'file.brs')).to.equal('file.brs');
        });
        it('works when both files are in subfolder', () => {
            expect(util.getRelativePath('sub/file.xml', 'sub/file.brs')).to.equal('file.brs');
        });
        it('works when source in root, target in subdir', () => {
            expect(util.getRelativePath('file.xml', 'sub/file.brs')).to.equal(n(`sub/file.brs`));
        });
        it('works when source in sub, target in root', () => {
            expect(util.getRelativePath('sub/file.xml', 'file.brs')).to.equal(n(`../file.brs`));
        });
        it('works when source and target are in different subs', () => {
            expect(util.getRelativePath('sub1/file.xml', 'sub2/file.brs')).to.equal(n(`../sub2/file.brs`));
        });
    });

    describe('findAllDeep', () => {
        class Person {
            constructor(
                public name: string,
                public parent?: Person
            ) {
            }
        }
        it('finds all properties deep', () => {
            let grandpa = new Person('grandpa');
            let dad = new Person('dad', grandpa);
            let me = new Person('me', dad);
            let people = util.findAllDeep(me, (x) => x instanceof Person);
            expect(people[0]).to.deep.include({ key: undefined, value: me });
            expect(people[1]).to.deep.include({ key: 'parent', value: dad });
            expect(people[2]).to.deep.include({ key: 'parent.parent', value: grandpa });
        });

        it('finds properties in arrays', () => {
            let results = util.findAllDeep<{ id: number }>({
                children: [{
                    id: 1,
                    name: 'bob',
                    children: [{
                        id: 2,
                        name: 'john'
                    }, {
                        id: 3,
                        name: 'bob'
                    }]
                }, {
                    id: 4,
                    name: 'bob'
                }]
            }, (x) => {
                return x.name === 'bob';
            });

            expect(results[0].key).to.eql('children.0');
            expect(results[0].value.id).to.eql(1);

            expect(results[1].key).to.eql('children.0.children.1');
            expect(results[1].value.id).to.eql(3);

            expect(results[2].key).to.eql('children.1');
            expect(results[2].value.id).to.eql(4);
        });

        it('prevents recursive infinite loop', () => {
            let objA = { name: 'a', sibling: undefined };
            let objB = { name: 'b', sibling: objA };
            objA.sibling = objB;
            expect(
                util.findAllDeep<any>(objA, x => ['a', 'b'].includes(x.name)).map(x => x.value.name)
            ).to.eql([
                'a',
                'b'
            ]);
        });
    });

    describe('padLeft', () => {
        it('stops at an upper limit to prevent terrible memory explosions', () => {
            expect(util.padLeft('', Number.MAX_VALUE, ' ')).to.be.lengthOf(1000);
        });
    });

    describe('tokenizeByWhitespace', () => {
        it('works with single chars', () => {
            expect(util.tokenizeByWhitespace('a b c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 4,
                text: 'c'
            }]);
        });

        it('works with tabs', () => {
            expect(util.tokenizeByWhitespace('a\tb\t c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 5,
                text: 'c'
            }]);

            it('works with leading whitespace', () => {
                expect(util.tokenizeByWhitespace('  \ta\tb\t c')).to.deep.equal([{
                    startIndex: 4,
                    text: 'a'
                }, {
                    startIndex: 6,
                    text: 'b'
                },
                {
                    startIndex: 9,
                    text: 'c'
                }]);
            });

            it('works with multiple characters in a word', () => {
                expect(util.tokenizeByWhitespace('abc 123')).to.deep.equal([{
                    startIndex: 0,
                    text: 'abc'
                }, {
                    startIndex: 4,
                    text: '123'
                }]);
            });
        });
    });

    describe('tokenizeBsDisableComment', () => {
        it('skips non disable comments', () => {
            expect(util.tokenizeBsDisableComment(
                Lexer.scan(`'not disable comment`).tokens[0]
            )).not.to.exist;
        });

        it('tokenizes bs:disable-line comment', () => {
            expect(util.tokenizeBsDisableComment(
                Lexer.scan(`'bs:disable-line`).tokens[0])
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: []
            });
        });

        it('works for special case', () => {
            expect(util.tokenizeBsDisableComment(
                Lexer.scan(`print "hi" 'bs:disable-line: 123456 999999   aaaab`).tokens[2])
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '123456',
                    range: Range.create(0, 29, 0, 35)
                }, {
                    code: '999999',
                    range: Range.create(0, 36, 0, 42)
                }, {
                    code: 'aaaab',
                    range: Range.create(0, 45, 0, 50)
                }]
            });
        });

        it('tokenizes bs:disable-line comment with codes', () => {
            expect(util.tokenizeBsDisableComment(
                Lexer.scan(`'bs:disable-line:1 2 3`).tokens[0])
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '1',
                    range: Range.create(0, 17, 0, 18)
                }, {
                    code: '2',
                    range: Range.create(0, 19, 0, 20)
                }, {
                    code: '3',
                    range: Range.create(0, 21, 0, 22)
                }]
            });
        });
    });
});

async function expectThrowAsync(callback) {
    let ex;
    try {
        await Promise.resolve(callback());
    } catch (e) {
        ex = e;
    }
    expect(ex, 'Expected to throw error').to.exist;
}

async function expectNotThrowAsync(callback) {
    let ex;
    try {
        await Promise.resolve(callback());
    } catch (e) {
        ex = e;
    }
    expect(ex, 'Expected not to throw error').not.to.exist;
}
