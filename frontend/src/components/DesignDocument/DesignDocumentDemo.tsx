'use client';

import DesignDocumentRenderer from './DesignDocumentRenderer';
import { designDocumentFixture } from './fixtures';

export default function DesignDocumentDemo() {
  return <DesignDocumentRenderer document={designDocumentFixture} />;
}
