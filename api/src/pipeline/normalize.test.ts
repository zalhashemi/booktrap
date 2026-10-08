import { describe, expect, it } from 'vitest';
import { authorSimilarity, isSameBook, normalizeTitle, normalizedKey, titleSimilarity } from './normalize';

describe('normalizeTitle', () => {
  it.each([
    ['The Secret History', 'secret history'],
    ['The Secret History: A Novel', 'secret history'],
    ['Babel (Or the Necessity of Violence)', 'babel'],
    ['Giovanni’s Room', 'giovannis room'],
    ['A Little Life', 'little life'],
    ['If We Were Villains - Special Edition', 'if we were villains'],
    ['Les Misérables', 'les miserables'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe('normalizedKey', () => {
  it('is stable across article, punctuation and name order differences', () => {
    expect(normalizedKey('The Song of Achilles', 'Madeline Miller')).toBe(normalizedKey('Song of Achilles', 'Miller, Madeline'));
  });
});

describe('similarity', () => {
  it('scores near-misses from blurry spines highly', () => {
    expect(titleSimilarity('The Secret Histroy', 'The Secret History')).toBeGreaterThan(0.8);
  });

  it('scores different books low', () => {
    expect(titleSimilarity('The Secret History', 'The Secret Garden')).toBeLessThan(0.75);
  });

  it('treats initials and full first names as the same author', () => {
    expect(authorSimilarity('J. Baldwin', 'James Baldwin')).toBeGreaterThanOrEqual(0.9);
    expect(authorSimilarity('Donna Tartt', 'Madeline Miller')).toBeLessThan(0.4);
  });
});

describe('isSameBook', () => {
  it('matches the same book written two ways', () => {
    expect(
      isSameBook({ title: 'The Heart’s Invisible Furies', author: 'John Boyne' }, { title: "The Heart's Invisible Furies: A Novel", author: 'Boyne, John' }),
    ).toBe(true);
  });

  it('matches by ISBN regardless of title wording', () => {
    expect(isSameBook({ title: 'Babel', author: null, isbn13: '9780063021426' }, { title: 'Babel: An Arcane History', author: 'R. F. Kuang', isbn13: '9780063021426' })).toBe(true);
  });

  it('keeps same-titled books by different authors apart', () => {
    expect(isSameBook({ title: 'Sunburn', author: 'Chloe Michelle Howarth' }, { title: 'Sunburn', author: 'Laura Lippman' })).toBe(false);
  });
});
