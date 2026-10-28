import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
export async function makeFixture(file) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('A quieter way to read research'); pdf.setAuthor('Jane Researcher');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = Array.from({ length: 3 }, () => pdf.addPage([612, 792]));
  const line = (n, text, y, size = 12, font = regular) => pages[n].drawText(text, { x: 55, y, size, font, color: rgb(.14, .2, .17) });
  line(0, 'A quieter way to read research', 718, 24, bold);
  line(0, 'Jane Researcher  /  aPDF demonstration paper', 687, 10);
  line(0, 'Abstract', 637, 15, bold);
  line(0, 'Attention attention ATTENTION. A reader should let ideas breathe.', 609);
  line(0, 'See Figure 1 for the result, Table 1 for measurements, and [1].', 582);
  line(0, 'Select Figure 1 here to try an unlinked reference preview.', 540);
  line(0, 'Search works across pages, with case and regular expressions.', 510);
  pages[0].drawText('cross', { x: 55, y: 480, size: 12, font: regular });
  pages[0].drawText('run', { x: 55 + regular.widthOfTextAtSize('cross', 12), y: 480, size: 12, font: regular });
  line(1, 'Results', 720, 22, bold);
  pages[1].drawRectangle({ x: 70, y: 400, width: 470, height: 250, color: rgb(.94, .97, .94) });
  for (let i = 0; i < 6; i++) pages[1].drawRectangle({ x: 110 + i * 65, y: 430, width: 34, height: 35 + i * 27, color: rgb(.24, .48, .37) });
  line(1, 'Figure 1. Better reading, one paper at a time.', 375, 12, bold);
  line(1, 'Table 1. Measurements', 315, 13, bold);
  line(1, 'Condition             Accuracy             Time', 282);
  line(1, 'With context          97.2%                12 seconds', 256);
  line(1, 'Without context       82.4%                31 seconds', 230);
  line(1, 'Attention to detail matters.', 180);
  line(2, 'References', 720, 22, bold);
  line(2, '[1] Researcher, J. (2026). Reading with context. Journal of Ideas.', 660, 11);
  line(2, 'Appendix: Pattern matching', 590, 15, bold);
  line(2, 'Measurements: 12, 24, 48. Email: reader@example.org', 555);
  // A short adversarial string is enough to exercise catastrophic backtracking.
  pages[2].drawText('a'.repeat(50) + '!', { x: 55, y: 60, size: 10, font: regular });
  const destinations = [
    ['figure.1', 1, 650], ['table.1', 1, 315], ['cite.1', 2, 670]
  ];
  const names = [];
  for (const [name, page, y] of destinations) names.push(PDFString.of(name), pdf.context.obj([pages[page].ref, PDFName.of('XYZ'), 55, y, null]));
  pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: { Names: names } }));
  const annotations = [];
  for (const [name, x, width] of [['figure.1', 79, 44], ['table.1', 246, 40], ['cite.1', 367, 18]]) {
    annotations.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, 580, x + width, 595], Border: [0, 0, 0], Dest: PDFString.of(name) })));
  }
  pages[0].node.set(PDFName.of('Annots'), pdf.context.obj(annotations));
  const outlineRoot = pdf.context.obj({ Type: 'Outlines', Count: 1 });
  const rootRef = pdf.context.register(outlineRoot);
  const outline = pdf.context.register(pdf.context.obj({ Title: PDFString.of('Results'), Parent: rootRef, Dest: PDFString.of('figure.1') }));
  outlineRoot.set(PDFName.of('First'), outline); outlineRoot.set(PDFName.of('Last'), outline);
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  await writeFile(file, await pdf.save());
}
if (process.argv[1] === new URL(import.meta.url).pathname) await makeFixture(process.argv[2] || 'test-results/research-demo.pdf');
