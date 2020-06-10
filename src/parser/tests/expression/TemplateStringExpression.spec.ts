/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement } from '../../Statement';
import { getTestTranspile } from '../../../files/BrsFile.spec';
import { Program, BrsFile } from '../../..';

describe('parser template String', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`a = \`hello \=world`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { tokens } = Lexer.scan(`a = \`hello      world\``);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
        it(`complex case`, () => {
            let { tokens } = Lexer.scan(`a = \`hello \${a.text} world \${"template" + m.getChars()} test\``);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`complex case`, () => {

            let { tokens } = Lexer.scan(`a = \`hello \${"world"}!
              I am a \${"template" + "\`string\`"} 
              and I am very \${["pleased"][0]} to meet you \${m.top.getChildCount()}
              the end. 
              goodnight`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`complex case that tripped up the tranpsile tests`, () => {

            let { tokens } = Lexer.scan(`a = ["one", "two", \`I am a complex example
            \${a.isRunning(["a","b","c"])}\`]`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
    });
});

describe('transpilation', () => {
    let rootDir = process.cwd();
    let program: Program;

    // @ts-ignore
    let file: BrsFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        file = new BrsFile('abs', 'rel', program);
    });
    afterEach(() => {
        program.dispose();
    });

    it('properly transpiles simple template string', async () => {
        await testTranspile(`a = \`hello world\``, `
        a = "hello world"
    `);
    });
    it('properly transpiles one line template string with expressions', async () => {
        await testTranspile(`a = \`hello \${a.text} world \${"template" + m.getChars()} test\``,
          `a = stdlib_concat(["hello ", a.text, " world ", "template" + m.getChars(), " test"])`);
    });
    it('properly transpiles simple multiline template string', async () => {
        await testTranspile(`a = \`hello world
I am multiline\``, `a = stdlib_concat(["hello world\nI am multiline"])`);
    });
    it('properly transpiles more complex multiline template string', async () => {
        await testTranspile(`a = \`hello world
I am multiline
\${a.isRunning()}
more\``, `a = stdlib_concat(["hello world\nI am multiline\n", a.isRunning(), "\nmore"])`);
    });
    it('properly transpiles complex multiline template string in array def', async () => {
        await testTranspile(`a = ["one", "two", \`I am a complex example
            \${a.isRunning(["a","b","c"])}\`]`);
    });

    it('properly transpiles complex multiline template string in array def, with nested template', async () => {
        await testTranspile(`a = ["one", "two", \`I am a complex example
            \${a.isRunning(["a","b","c", \`template ${"inside"} template\`])}\`]`);
    });

});
