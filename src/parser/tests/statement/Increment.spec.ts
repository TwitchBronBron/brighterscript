import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser postfix unary expressions', () => {
    it('parses postfix \'++\' for variables', () => {
        let { statements, errors } = Parser.parse([
            identifier('foo'),
            token(TokenKind.PlusPlus, '++'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses postfix \'--\' for dotted get expressions', () => {
        let { statements, errors } = Parser.parse([
            identifier('obj'),
            token(TokenKind.Dot, '.'),
            identifier('property'),
            token(TokenKind.MinusMinus, '--'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses postfix \'++\' for indexed get expressions', () => {
        let { statements, errors } = Parser.parse([
            identifier('obj'),
            token(TokenKind.LeftSquareBracket, '['),
            identifier('property'),
            token(TokenKind.RightSquareBracket, ']'),
            token(TokenKind.PlusPlus, '++'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('disallows consecutive postfix operators', () => {
        let { errors } = Parser.parse([
            identifier('foo'),
            token(TokenKind.PlusPlus, '++'),
            token(TokenKind.PlusPlus, '++'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(1);
        expect(errors[0]).deep.include({
            message: 'Consecutive increment/decrement operators are not allowed'
        });
    });

    it('disallows postfix \'--\' for function call results', () => {
        let { errors } = Parser.parse([
            identifier('func'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.MinusMinus, '--'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(1);
        expect(errors[0]).to.deep.include({
            message: 'Increment/decrement operators are not allowed on the result of a function call'
        });
    });

    it('allows \'++\' at the end of a function', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Sub, 'sub'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            identifier('someValue'),
            token(TokenKind.PlusPlus, '++'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndSub, 'end sub'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 0| someNumber++
         */
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'someNumber',
                isReserved: false,
                range: Range.create(0, 0, 0, 10)
            },
            {
                kind: TokenKind.PlusPlus,
                text: '++',
                isReserved: false,
                range: Range.create(0, 10, 0, 12)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 12, 0, 13)
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).deep.include(
            Range.create(0, 0, 0, 12)
        );
    });
});
