import * as sinonImport from 'sinon';

import { Program } from '../Program';
import { getTestTranspile } from './BrsFile.spec';
import { BrsFile } from './BrsFile';
import { expect } from 'chai';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { Diagnostic, Range, DiagnosticSeverity } from 'vscode-languageserver';
import { ParseMode } from '../parser/Parser';

let sinon = sinonImport.createSandbox();

describe('BrsFile BrighterScript classes', () => {
    let rootDir = process.cwd();
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        sinon.restore();
    });

    async function addFile(relativePath: string, text: string) {
        return await program.addOrReplaceFile({ src: `${rootDir}/${relativePath}`, dest: relativePath }, text) as BrsFile;
    }

    it('detects all classes after parse', async () => {
        let file = (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
            end class
            class Duck
            end class
        `) as BrsFile);
        expect(file.classStatements.map(x => x.getName(ParseMode.BrighterScript)).sort()).to.eql(['Animal', 'Duck']);
    });

    describe('transpile', () => {
        it('works for simple  class', async () => {
            await testTranspile(`
                class Duck
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'main.bs');
        });

        it('registers the constructor and properly handles its parameters', async () => {
            await testTranspile(`
                class Duck
                    sub new(name as string, age as integer)
                    end sub
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub(name as string, age as integer)
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `, undefined, 'main.bs');
        });

        it('properly handles child class constructor override and super calls', async () => {
            await testTranspile(`
                class Animal
                    sub new(name as string)
                    end sub
                end class

                class Duck extends Animal
                    sub new(name as string, age as integer) 
                        super(name)
                        super.DoSomething()
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub(name as string)
                    end sub
                    return instance
                end function
                function Animal(name as string)
                    instance = __Animal_builder()
                    instance.new(name)
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub(name as string, age as integer)
                        m.super0_new(name)
                        m.super0_DoSomething()
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `, undefined, 'main.bs');
        });

        it('new keyword transpiles correctly', async () => {
            await addFile('source/Animal.bs', ` 
                class Animal
                    sub new(name as string)
                    end sub
                end class
            `);
            await testTranspile(`
                sub main()
                    a = new Animal("donald")
                end sub
            `, `
                sub main()
                    a = Animal("donald")
                end sub
            `, undefined, 'main.bs');
        });
    });

    it('detects missing call to super', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub new()
                end sub
            end class
            class Duck extends Animal
                sub new()
                end sub
            end class
        `) as BrsFile);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.classConstructorMissingSuperCall().message
        );
    });

    it.skip('detects calls to unknown m methods', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub new()
                    m.methodThatDoesNotExist()
                end sub
            end class
        `) as BrsFile);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.methodDoesNotExistOnType('methodThatDoesNotExist', 'Animal')
        );
    });

    it('detects duplicate member names', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
                public name
                public sub name()
                end sub
                public sub age()
                end sub
                public sub age()
                end sub
                public age
            end class
        `) as BrsFile);
        await program.validate();
        let diagnostics = program.getDiagnostics().map(x => {
            return {
                code: x.code,
                message: x.message,
                range: x.range,
                severity: DiagnosticSeverity.Error
            };
        });
        expect(diagnostics).to.eql(<Partial<Diagnostic>[]>[{
            ...DiagnosticMessages.duplicateIdentifier('name'),
            range: Range.create(3, 23, 3, 27)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('name'),
            range: Range.create(4, 27, 4, 31)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('age'),
            range: Range.create(8, 27, 8, 30)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('age'),
            range: Range.create(10, 23, 10, 26)
        }]);
    });

    it('detects mismatched member type in child class', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
            end class
            class Duck extends Animal
                public function name()
                    return "Donald"
                end function
            end class
        `) as BrsFile);
        await program.validate();
        expect(
            program.getDiagnostics().map(x => x.message).sort()[0]
        ).to.eql(
            DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor('method', 'field', 'Animal').message
        );
    });

    it('detects overridden property name in child class', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
            end class
            class Duck extends Animal
                public name
            end class
        `) as BrsFile);
        await program.validate();
        let diagnostics = program.getDiagnostics().map(x => x.message);
        expect(diagnostics).to.eql([
            DiagnosticMessages.memberAlreadyExistsInParentClass('field', 'Animal').message
        ]);
    });

    it('detects overridden methods without override keyword', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub speak()
                end sub
            end class
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]).to.exist.and.to.include({
            ...DiagnosticMessages.missingOverrideKeyword('Animal')
        });
    });

    it('detects extending unknown parent class', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]).to.exist.and.to.deep.include({
            ...DiagnosticMessages.classCouldNotBeFound('Animal', 'global'),
            range: Range.create(1, 31, 1, 37)
        });
    });

    it('catches newable class without namespace name', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Duck
                end class
            end namespace
            sub main()
                ' this should be an error because the proper name is NameA.NameB.Duck"
                d = new Duck()
            end sub
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('Duck', 'global').message
        );
    });

    it('supports newable class namespace inference', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Duck
                end class
                sub main()
                    d = new Duck()
                end sub
            end namespace
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches extending unknown namespaced class', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends NameA.NameB.Animal1
                end class
            end namespace
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('NameA.NameB.Animal1', 'global').message
        );
    });

    it('supports omitting namespace prefix for items in same namespace', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends Animal
                end class
            end namespace
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches duplicate root-level class declarations', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
            end class
            class Animal
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('global', 'Animal').message
        );
    });

    it('catches duplicate namespace-level class declarations', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Animal
            end namespace
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('global', 'NameA.NameB.Animal').message
        );
    });

    it('catches namespaced class name which is the same as a global class', async () => {
        (await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
            end namespace
            class Animal
            end class
        `) as BrsFile);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.namespacedClassCannotShareNamewithNonNamespacedClass('Animal').message
        );
    });

});
