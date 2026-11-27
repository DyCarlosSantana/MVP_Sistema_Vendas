import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Relogio {
  agora() {
    return 42;
  }
}

@Injectable()
class Servico {
  // Sem @Inject: só funciona se o transformador emitir os metadados de tipo do construtor.
  constructor(private readonly relogio: Relogio) {}
  valor() {
    return this.relogio.agora();
  }
}

describe('NestJS: injeção de dependência no ambiente de teste', () => {
  it('resolve a dependência pelos metadados emitidos pelo SWC', async () => {
    // Prova direta: o transformador emitiu o metadado de tipo do construtor.
    expect(Reflect.getMetadata('design:paramtypes', Servico)).toEqual([Relogio]);
    const modulo = await Test.createTestingModule({ providers: [Relogio, Servico] }).compile();
    expect(modulo.get(Servico).valor()).toBe(42);
  });
});
