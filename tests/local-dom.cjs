// Minimal DOM fixture for controller/markup tests. It does not implement layout or painting.
const assert = require('node:assert/strict');
const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => key[0] === '#'
    ? String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key]);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function makeDOM() {
    const animations = [];
    const document = {};
    class Node {
        constructor(tag, attributes = {}, value = '') {
            this.tagName = tag.toUpperCase(); this.nodeValue = value;
            this.nodeType = tag === '#text' ? 3 : tag === '#fragment' ? 11 : 1;
            this.attrs = { ...attributes }; this.childNodes = []; this.parentNode = null;
            this.dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, val]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), val]));
            this.style = { setProperty(key, val) { this[key] = val; }, removeProperty(key) { delete this[key]; } };
            this.listeners = new Map(); this.value = attributes.value || ''; this.checked = 'checked' in attributes;
            this.disabled = 'disabled' in attributes; this.hidden = 'hidden' in attributes; this.scrollTop = 0;
            this.classList = {
                contains: key => this.className.split(/\s+/).includes(key),
                add: (...keys) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
                remove: (...keys) => { this.className = this.className.split(/\s+/).filter(key => !keys.includes(key)).join(' '); },
                toggle: (key, enabled) => { const on = enabled ?? !this.classList.contains(key); on ? this.classList.add(key) : this.classList.remove(key); return on; },
            };
        }
        get id() { return this.attrs.id || ''; }
        set id(value) { this.attrs.id = value; }
        get className() { return this.attrs.class || ''; }
        set className(value) { this.attrs.class = value; }
        get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
        get children() { return this.childNodes.filter(node => node.nodeType === 1); }
        get isConnected() { return this === document.body || this === document.head || !!this.parentNode?.isConnected; }
        get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
        set textContent(value) { this.childNodes = []; this.appendChild(new Node('#text', {}, String(value))); }
        get innerHTML() { return this.childNodes.map(node => node.outerHTML).join(''); }
        get outerHTML() {
            if (this.nodeType === 3) return escape(this.nodeValue);
            if (this.nodeType === 11) return this.innerHTML;
            const tag = this.tagName.toLowerCase();
            const attrs = Object.entries(this.attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
            return `<${tag}${attrs}>${this.innerHTML}${voids.has(tag) ? '' : `</${tag}>`}`;
        }
        set innerHTML(html) {
            this.childNodes.forEach(node => { node.parentNode = null; }); this.childNodes = [];
            const stack = [this];
            for (const match of String(html).matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
                const token = match[0];
                if (token.startsWith('<!--') || token.startsWith('<!')) continue;
                if (token.startsWith('</')) {
                    const tag = token.slice(2, -1).trim().toUpperCase();
                    assert.equal(stack.pop()?.tagName, tag, `Unbalanced generated markup: ${tag}`); continue;
                }
                if (!token.startsWith('<')) { stack.at(-1).appendChild(new Node('#text', {}, decode(token))); continue; }
                const [, tag, attrText] = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);
                const attrs = {};
                for (const attr of attrText.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
                const node = new Node(tag, attrs); stack.at(-1).appendChild(node);
                if (!voids.has(tag) && !token.endsWith('/>')) stack.push(node);
            }
            assert.equal(stack.length, 1, 'Unclosed generated tags');
        }
        appendChild(node) {
            if (node.nodeType === 11) { [...node.childNodes].forEach(child => this.appendChild(child)); return node; }
            node.remove(); node.parentNode = this; this.childNodes.push(node); return node;
        }
        remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; }
        replaceWith(node) {
            const parent = this.parentNode, index = parent.childNodes.indexOf(this);
            const replacements = node.nodeType === 11 ? [...node.childNodes] : [node];
            replacements.forEach(item => { item.parentNode = parent; });
            parent.childNodes.splice(index, 1, ...replacements); this.parentNode = null;
        }
        setAttribute(key, value) { this.attrs[key] = String(value); }
        getAttribute(key) { return this.attrs[key] ?? null; }
        removeAttribute(key) { delete this.attrs[key]; }
        contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
        matches(selector) {
            const tag = selector.match(/^[\w-]+/), id = selector.match(/#([\w-]+)/);
            if (tag && this.tagName !== tag[0].toUpperCase()) return false;
            if (id && this.id !== id[1]) return false;
            for (const cls of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls[1])) return false;
            for (const attr of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
                if (!(attr[1] in this.attrs) || (attr[2] !== undefined && this.attrs[attr[1]] !== attr[2])) return false;
            }
            return true;
        }
        closest(selector) { let node = this; while (node?.nodeType === 1) { if (selector.split(',').some(s => node.matches(s.trim()))) return node; node = node.parentElement; } return null; }
        querySelectorAll(selector) {
            const result = [];
            const alternatives = selector.split(',').map(s => s.trim().split(/\s+/));
            const visit = root => {
                for (const node of root.children) {
                    if (alternatives.some(parts => {
                        if (!node.matches(parts.at(-1))) return false;
                        let index = parts.length - 2, parent = node.parentElement;
                        while (parent && index >= 0) { if (parent.matches(parts[index])) index--; parent = parent.parentElement; }
                        return index < 0;
                    })) result.push(node);
                    visit(node);
                }
            };
            visit(this); return result;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
        removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
        focus() { document.activeElement = this; }
        animate(frames, options) {
            let resolve, reject;
            const finished = new Promise((a, b) => { resolve = a; reject = b; });
            const animation = { frames, options, finished, cancel() { reject(new Error('cancelled')); }, complete: resolve };
            animations.push(animation); return animation;
        }
    }
    document.body = new Node('body'); document.head = new Node('head'); document.activeElement = document.body;
    document.createElement = tag => new Node(tag);
    document.createTextNode = text => new Node('#text', {}, text);
    document.createDocumentFragment = () => new Node('#fragment');
    document.querySelectorAll = selector => [...document.body.querySelectorAll(selector), ...document.head.querySelectorAll(selector)];
    document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
    document.getElementById = id => document.querySelector('#' + id);
    document.addEventListener = () => {}; document.removeEventListener = () => {};
    document.createTreeWalker = root => {
        const nodes = [];
        const visit = node => { if (node.nodeType === 3) nodes.push(node); else node.childNodes.forEach(visit); };
        visit(root); let index = 0; return { nextNode: () => nodes[index++] || null };
    };
    return { document, animations };
}
module.exports = { makeDOM };
