import { extractEditablePages, extractPreviewSource } from '../designContent';

console.log('--- TESTE: extractEditablePages contra falsos positivos ---\n');

const fixtures = [
  {
    name: '1. Array legado válido',
    input: [{ width: 1080, height: 1080, layers: [{ id: '1', type: 'text', x: 0, y: 0, width: 100, height: 100, zIndex: 1 }] }],
    expectedStatus: 'editable',
  },
  {
    name: '2. Hybrid-design válido com pages',
    input: {
      kind: 'hybrid-design',
      version: 1,
      source: 'codegen',
      document: { foo: 'bar' },
      pages: [{ width: 1080, height: 1080, layers: [{ id: '2', type: 'image', x: 10, y: 10, width: 50, height: 50, zIndex: 2 }] }]
    },
    expectedStatus: 'editable',
  },
  {
    name: '3. Hybrid-design SEM pages (uncompiled)',
    input: {
      kind: 'hybrid-design',
      version: 1,
      source: 'codegen',
      document: { foo: 'bar' }
    },
    expectedStatus: 'hybrid-uncompiled',
  },
  {
    name: '4. Post de imagem válido',
    input: { type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo...' },
    expectedStatus: 'editable',
  },
  {
    name: '5. Post de imagem SEM url',
    input: { type: 'image', dataUrl: '' },
    expectedStatus: 'not-editable',
  },
  {
    name: '6. Objeto aleatório (inválido)',
    input: { someRandomData: 123 },
    expectedStatus: 'not-editable', // reason: invalid
  },
  {
    name: '7. Hybrid-design com pages inválido (layers nulas)',
    input: {
      kind: 'hybrid-design',
      version: 1,
      source: 'codegen',
      document: {},
      pages: [{ width: 1080, height: 1080, layers: [null, { id: '1', type: 'text' }] }]
    },
    expectedStatus: 'hybrid-uncompiled', // fallback to uncompiled if pages are not valid LegacyDesignPages
  },
  {
    name: '8. String pura',
    input: 'just a string',
    expectedStatus: 'not-editable',
  },
  {
    name: '9. Null',
    input: null,
    expectedStatus: 'not-editable',
  },
];

let failed = 0;

for (const fixture of fixtures) {
  const result = extractEditablePages(fixture.input);
  let status: string = result.status;
  if (status === 'not-editable' && 'reason' in result) {
    status = `not-editable (${result.reason})`;
  }
  
  const expectedMatch = result.status === fixture.expectedStatus;
  
  if (expectedMatch) {
    console.log(`✅ PASS: ${fixture.name} -> ${status}`);
  } else {
    console.log(`❌ FAIL: ${fixture.name}`);
    console.log(`   Esperado: ${fixture.expectedStatus}`);
    console.log(`   Recebido: ${status}`);
    failed++;
  }
}

console.log(`\nResumo: ${fixtures.length - failed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);

console.log('\n--- TESTE: extractPreviewSource ---\n');

const previewFixtures = [
  {
    name: '1. Legacy DesignPages sem previewUrl',
    input: [{ width: 1080, height: 1080, layers: [] }],
    previewUrl: undefined,
    expectedKind: 'design',
  },
  {
    name: '2. Legacy DesignPages com previewUrl',
    input: [{ width: 1080, height: 1080, layers: [] }],
    previewUrl: 'https://preview.png',
    expectedKind: 'image',
  },
  {
    name: '3. Image post sem previewUrl',
    input: { type: 'image', dataUrl: 'https://data.url' },
    previewUrl: undefined,
    expectedKind: 'image',
  },
  {
    name: '4. Hybrid-design uncompiled',
    input: { kind: 'hybrid-design', version: 1, source: 'codegen', document: {} },
    previewUrl: undefined,
    expectedKind: 'hybrid-document',
  },
  {
    name: '5. Hybrid-design compiled',
    input: { kind: 'hybrid-design', version: 1, source: 'codegen', document: {}, pages: [{ width: 1080, height: 1080, layers: [] }] },
    previewUrl: undefined,
    expectedKind: 'design',
  },
  {
    name: '6. Invalid content',
    input: { foo: 'bar' },
    previewUrl: undefined,
    expectedKind: 'none',
  }
];

let failedPreview = 0;

for (const fixture of previewFixtures) {
  const result = extractPreviewSource(fixture.input, fixture.previewUrl);
  const expectedMatch = result?.kind === fixture.expectedKind || (result === null && fixture.expectedKind === 'none');
  
  if (expectedMatch) {
    console.log(`✅ PASS: ${fixture.name} -> ${result?.kind || 'none'}`);
  } else {
    console.log(`❌ FAIL: ${fixture.name}`);
    console.log(`   Esperado: ${fixture.expectedKind}`);
    console.log(`   Recebido: ${result?.kind || 'none'}`);
    failedPreview++;
  }
}

console.log(`\nResumo Preview: ${previewFixtures.length - failedPreview} pass, ${failedPreview} fail`);
if (failedPreview > 0) process.exit(1);

