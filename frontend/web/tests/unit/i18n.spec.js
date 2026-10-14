import { describe, it, expect } from 'vitest';
import { messages } from '@/i18n';

describe('i18n Localization Parity', () => {
  it('garante que todos os identificadores em pt existem em en e vice-versa', () => {
    const ptKeys = Object.keys(messages.pt);
    const enKeys = Object.keys(messages.en);

    const missingInEn = ptKeys.filter((k) => !(k in messages.en));
    const missingInPt = enKeys.filter((k) => !(k in messages.pt));

    expect(missingInEn).toEqual([]);
    expect(missingInPt).toEqual([]);
  });

  it('nenhum texto de tradução deve estar vazio', () => {
    for (const [lang, dict] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `${lang}.${key} deve ser uma string`).toBe('string');
        expect(value.trim().length, `${lang}.${key} não pode estar vazio`).toBeGreaterThan(0);
      }
    }
  });
});
