/**
 * Changes element attributes (inline `style`, SVG `fill`/`stroke`, legacy `bgcolor`) and remembers
 * the original values so that `restore()` returns the DOM byte-for-byte.
 */
export class DomPatcher {
  private readonly originals = new Map<Element, Map<string, string | null>>();
  /** Inline properties we have set, per element. */
  private readonly styled = new Map<Element, Set<string>>();

  get size(): number {
    return this.originals.size;
  }

  private remember(el: Element, attr: string, value: string | null = el.getAttribute(attr)) {
    let attrs = this.originals.get(el);
    if (!attrs) this.originals.set(el, (attrs = new Map()));
    if (!attrs.has(attr)) attrs.set(attr, value);
  }

  setAttr(el: Element, attr: string, value: string) {
    if (el.getAttribute(attr) === value) return;
    this.remember(el, attr);
    el.setAttribute(attr, value);
  }

  setStyle(el: HTMLElement | SVGElement, prop: string, value: string, important = false) {
    // Read the attribute BEFORE accessing `el.style`: Chrome may materialize an empty `style=""`.
    const attrBefore = el.getAttribute('style');
    const style = el.style;
    if (style.getPropertyValue(prop) === value && (style.getPropertyPriority(prop) === 'important') === important) return;
    this.remember(el, 'style', attrBefore);
    style.setProperty(prop, value, important ? 'important' : '');
    let props = this.styled.get(el);
    if (!props) this.styled.set(el, (props = new Set()));
    props.add(prop);
  }

  hasStyle(el: Element, prop: string): boolean {
    return this.styled.get(el)?.has(prop) ?? false;
  }

  /** The site changed the attribute itself — the new value becomes the "original". */
  forget(el: Element, attr: string) {
    this.originals.get(el)?.delete(attr);
    if (attr === 'style') this.styled.delete(el);
  }

  restore() {
    for (const [el, attrs] of this.originals) {
      for (const [attr, value] of attrs) {
        if (value === null) el.removeAttribute(attr);
        else el.setAttribute(attr, value);
      }
    }
    this.originals.clear();
    this.styled.clear();
  }
}
