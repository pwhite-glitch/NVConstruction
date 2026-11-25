// Prompt 107c: exhibit pages must render while the portal tab is hidden behind the Edit & Print window.
const fs = require('fs')
const path = require('path')

const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'exhibit-pages-client.js'), 'utf8')

describe('renderPdfPages renders with the print intent (no requestAnimationFrame)', () => {
  test("every page.render call passes intent: 'print'", () => {
    const calls = client.match(/page\.render\([^)]*\)/g) || []
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c).toContain("intent: 'print'")
    expect(client).toContain("page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise")
  })

  test('the render promise is wrapped in a per-page 20 s withTimeout', () => {
    expect(client).toContain(
      "await withTimeout(page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise, 20000, `page ${n} did not render`)"
    )
  })

  test('page.cleanup() still runs in finally after the render', () => {
    const renderAt = client.indexOf('page.render(')
    const finallyAt = client.indexOf('} finally {', renderAt)
    const cleanupAt = client.indexOf('page.cleanup()', renderAt)
    expect(finallyAt).toBeGreaterThan(renderAt)
    expect(cleanupAt).toBeGreaterThan(finallyAt)
  })

  test('explains why (hidden opener tab, rAF)', () => {
    expect(client).toMatch(/requestAnimationFrame/)
    expect(client).toMatch(/hidden/)
  })
})
