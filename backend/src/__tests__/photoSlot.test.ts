import { describe, it, expect } from 'vitest';
import { listPhotoSlots, setPhotoInSlot, PhotoSlotNotFoundError } from '../lib/photoSlot';
import { sanitizeSlideHtml } from '../lib/htmlDesign';

const VAZIO = `<style>.s1-foto{position:absolute;left:60%;top:8%;width:36%;height:84%;background:#D8E9F3}</style>
<h1 class="s1-t">Título</h1>
<div data-photo-slot="1" class="s1-foto" style="border:1px solid #8E242E"></div>`;

const DOIS = `<div data-photo-slot="a" style="width:100px"></div><div data-photo-slot="b" style="width:200px"></div>`;

describe('listPhotoSlots', () => {
  it('acha o espaço vazio e informa o enquadramento padrão', () => {
    expect(listPhotoSlots(VAZIO)).toEqual([
      { slot: '1', hasPhoto: false, src: undefined, position: { x: 50, y: 50 }, fit: 'cover' },
    ]);
  });

  it('mantém a ordem de aparição quando há mais de um', () => {
    expect(listPhotoSlots(DOIS).map((s) => s.slot)).toEqual(['a', 'b']);
  });

  it('slide sem espaço de foto devolve lista vazia', () => {
    expect(listPhotoSlots('<h1>Só texto</h1>')).toEqual([]);
  });

  it('lê foto, posição e ajuste de um espaço já preenchido', () => {
    const html = `<div data-photo-slot="1"><img src="https://x/y.jpg" style="object-fit:contain;object-position:20% 80%"></div>`;
    expect(listPhotoSlots(html)[0]).toMatchObject({
      hasPhoto: true,
      src: 'https://x/y.jpg',
      position: { x: 20, y: 80 },
      fit: 'contain',
    });
  });
});

describe('setPhotoInSlot', () => {
  it('põe a foto dentro do espaço, com enquadramento, sem tocar no resto do layout', () => {
    const out = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/amanda.jpg' });
    const slot = listPhotoSlots(out)[0]!;
    expect(slot).toMatchObject({ hasPhoto: true, src: 'https://cdn/amanda.jpg', fit: 'cover' });
    expect(out).toContain('<h1 class="s1-t">Título</h1>'); // texto intocado
    expect(out).toContain('.s1-foto{position:absolute;left:60%'); // CSS do artista intocado
    expect(out).toContain('border:1px solid #8E242E'); // estilo do espaço preservado
    expect(out).toContain('overflow:hidden'); // a foto não vaza da moldura
  });

  it('guarda o enquadramento pedido, limitado a 0–100', () => {
    const out = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/a.jpg', position: { x: 130, y: -5 } });
    expect(listPhotoSlots(out)[0]!.position).toEqual({ x: 100, y: 0 });
  });

  it('trocar a foto reaproveita a <img>: uma só imagem no espaço', () => {
    const primeira = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/a.jpg' });
    const segunda = setPhotoInSlot(primeira, '1', { url: 'https://cdn/b.jpg' });
    expect((segunda.match(/<img/g) ?? []).length).toBe(1);
    expect(listPhotoSlots(segunda)[0]!.src).toBe('https://cdn/b.jpg');
  });

  it('trocar só o enquadramento mantém a mesma foto e o ajuste anterior', () => {
    const a = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/a.jpg', position: { x: 30, y: 40 } });
    const b = setPhotoInSlot(a, '1', { url: 'https://cdn/a.jpg' });
    expect(listPhotoSlots(b)[0]!.position).toEqual({ x: 30, y: 40 });
  });

  it('esvaziar devolve o espaço para uma próxima foto, e o espaço continua lá', () => {
    const cheio = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/a.jpg' });
    const vazio = setPhotoInSlot(cheio, '1', null);
    expect(listPhotoSlots(vazio)).toMatchObject([{ slot: '1', hasPhoto: false }]);
    expect(vazio).not.toContain('<img');
  });

  it('mexe só no espaço pedido quando há vários', () => {
    const out = setPhotoInSlot(DOIS, 'b', { url: 'https://cdn/b.jpg' });
    const [a, b] = listPhotoSlots(out);
    expect(a!.hasPhoto).toBe(false);
    expect(b!.hasPhoto).toBe(true);
  });

  it('espaço inexistente falha com erro próprio, sem alterar nada', () => {
    expect(() => setPhotoInSlot(VAZIO, '9', { url: 'https://cdn/a.jpg' })).toThrow(PhotoSlotNotFoundError);
  });

  it('o id do espaço vindo do cliente nunca vira seletor (aspas, colchetes, vírgula)', () => {
    expect(() => setPhotoInSlot(VAZIO, '1"],[data-x="', { url: 'u' })).toThrow(PhotoSlotNotFoundError);
  });

  it('sobrevive à sanitização do slide: o espaço e o enquadramento continuam lá', () => {
    const out = setPhotoInSlot(VAZIO, '1', { url: 'https://cdn/a.jpg', position: { x: 25, y: 75 } });
    const limpo = sanitizeSlideHtml(out);
    expect(listPhotoSlots(limpo)[0]).toMatchObject({
      hasPhoto: true,
      src: 'https://cdn/a.jpg',
      position: { x: 25, y: 75 },
    });
  });
});
