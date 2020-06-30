import { standardizePath as s } from './util';
import { Program } from './Program';
import { expect } from 'chai';

let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe('globalCallables', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingFolderPath
        });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('val', () => {
        it('allows single parameter', async () => {
            await program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print val("1001")
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });

        it('allows both parameters', async () => {
            await program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print val("1001", 10)
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });
    });

    describe('StrI', () => {
        it('allows single parameter', async () => {
            await program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print StrI(2)
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });

        it('allows both parameters', async () => {
            await program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print StrI(2, 10)
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });
    });


});
