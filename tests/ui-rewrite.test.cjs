// Local controller/markup checks only: no browser layout, SillyTavern API or real chat data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeDOM } = require('./local-dom.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function fixture(settings = {}) {
    const { document, animations } = makeDOM();
    const storage = new Map([['st-chatvault-settings', JSON.stringify(settings)]]);
    const timers = new Map(), listeners = new Set();
    let timerId = 0;
    const motion = {
        matches: false,
        addEventListener: (_, listener) => listeners.add(listener),
        removeEventListener: (_, listener) => listeners.delete(listener),
    };
    const context = vm.createContext({
        document, NodeFilter: { SHOW_TEXT: 4 },
        console: { log() {}, warn() {} },
        jQuery() {}, // Do not run the extension's startup or contact a running tavern.
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        window: {
            matchMedia: query => query.includes('reduced-motion') ? motion : { matches: false },
            getSelection: () => ({ toString: () => '' }), removeEventListener() {},
        },
        IntersectionObserver: class { observe() {} disconnect() {} },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id),
        fetch() { throw new Error('Network access is forbidden in local UI tests'); },
    });
    const run = code => vm.runInContext(code, context);
    run(source);
    document.body.innerHTML = '<div id="chatvault_overlay"><div id="chatvault_panel"><div id="cv_body"></div><div id="cv_pagination"></div></div></div><div id="chatvault_settings"><select id="cv_set_theme"></select><div id="cv_color_drawer_wrap"></div></div>';
    run("panelEl = document.getElementById('chatvault_overlay');");
    const character = { name: '测试角色', avatar: 'fixture.png' };
    function seed(chats = [{ file_name: '第一段故事', mes: 12 }], person = character) {
        context.fixtureCharacter = person;
        context.fixtureChats = chats;
        run('charactersCache = [fixtureCharacter]; chatsByAvatar = { [fixtureCharacter.avatar]: fixtureChats }; render();');
        return document.querySelector('.cv-record');
    }
    const click = node => {
        assert.equal(typeof node?.onclick, 'function', 'The control must have an event handler');
        node.onclick({ target: node, currentTarget: node, stopPropagation() {} });
    };
    return { document, animations, storage, timers, listeners, motion, context, run, seed, click };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function access(card, side) {
    for (const face of card.querySelectorAll('.cv-record-face')) {
        const enabled = face.classList.contains('cv-record-' + side);
        assert.equal(face.getAttribute('aria-hidden'), String(!enabled));
        assert.equal(face.inert, !enabled);
        for (const button of face.querySelectorAll('button')) assert.equal(button.tabIndex, enabled ? 0 : -1);
    }
}
function settled(f, card, side = 'back') {
    assert.equal(f.run('cardTurns.size'), 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(card.classList.contains('is-turning'), false);
    assert.equal(card.getAttribute('aria-busy'), null);
    access(card, side);
}

test('long titles and special characters retain full text without creating HTML', () => {
    const f = fixture();
    const title = '很长的故事标题'.repeat(80) + '<img src=x onerror=alert(1)> & "结尾"';
    const card = f.seed([{ file_name: title }]);
    assert.equal(card.querySelector('.cv-record-title').textContent, title);
    assert.equal(card.querySelector('.cv-record-title').getAttribute('title'), title);
    assert.equal(card.querySelector('.cv-record-story').textContent, title);
    assert.equal(card.querySelectorAll('img').length, 1);
    assert.equal(card.querySelectorAll('[data-act="flip"]').length, 2);
});

test('a missing cover uses the character initial and keeps card actions', () => {
    const f = fixture({ cardMotion: false });
    const card = f.seed(undefined, { name: '无封面角色', avatar: '' });
    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('.cv-cover-initial').textContent, '无');
    access(card, 'front');
    const cover = card.querySelector('.cv-record-cover');
    assert.equal(cover.tagName, 'BUTTON');
    cover.focus();
    f.click(cover);
    settled(f, card);
    f.click(card.querySelector('[data-act="star"]'));
    assert.equal(card.querySelector('[data-act="star"]').getAttribute('aria-pressed'), 'true');
    f.click(card.querySelector('.cv-record-back [data-act="flip"]'));
    settled(f, card, 'front');
    assert.equal(f.document.activeElement, cover);
});

test('compact front routes reading and jumping to the original chat and keeps management on the back', () => {
    const f = fixture({ cardMotion: false });
    const file = '存档 & "第一章".jsonl';
    const card = f.seed([{ file_name: file }]);
    const front = card.querySelector('.cv-record-front');
    f.run(`
        var entryCalls = [];
        enterReader = (person, file) => entryCalls.push(['reader', person.name, file]);
        jumpToChat = (person, file) => entryCalls.push(['open', person.name, file]);
        openEditModal = (person, file) => entryCalls.push(['edit', person.name, file]);
    `);
    f.click(front.querySelector('[data-act="reader"]'));
    f.click(front.querySelector('[data-act="open"]'));
    assert.equal(f.run('cardTurns.size'), 0);
    assert.equal(front.querySelector('[data-act="edit"]'), null);
    assert.equal(front.querySelector('[data-act="star"]'), null);
    f.click(front.querySelector('[data-act="flip"]'));
    access(card, 'back');
    f.click(card.querySelector('.cv-record-back [data-act="edit"]'));
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(entryCalls)')), [
        ['reader', '测试角色', file], ['open', '测试角色', file], ['edit', '测试角色', file],
    ]);
});

test('compact preview retains cached literal text and does not flip when selected', () => {
    const f = fixture();
    const text = '<think>不应显示</think>窗外的雨 <b>还没有停</b> & "来信"';
    f.context.previewText = text;
    f.run(`setupPreviewObserver(); previewCacheSet(metaKey('fixture.png', '第一段故事'), previewText);`);
    const card = f.seed();
    const preview = card.querySelector('.cv-record-front .cv-preview');
    assert.equal(preview.textContent, '窗外的雨 <b>还没有停</b> & "来信"');
    assert.equal(preview.querySelector('b'), null);
    assert.equal(preview.classList.contains('is-loading'), false);
    assert.equal(preview.listeners.has('contextmenu'), true);
    assert.equal(preview.listeners.has('pointerdown'), true);
    card.onclick({ target: preview });
    assert.equal(f.run('cardTurns.size'), 0);
    access(card, 'front');
    f.run('render();');
    assert.equal(f.document.querySelector('.cv-preview').textContent, preview.textContent);
});

test('an unavailable cover image hides itself to reveal the fallback', () => {
    const f = fixture();
    const card = f.seed();
    const img = card.querySelector('img');
    // Exercise the inline handler; actual image loading still needs a browser.
    new Function(img.getAttribute('onerror')).call(img);
    assert.equal(img.hidden, true);
    assert.equal(card.querySelector('.cv-cover-initial').textContent, '测');
});

test('card metadata shows escaped tags only when present and preserves count descriptions', () => {
    const f = fixture();
    const tags = ['日常', '<img src=x onerror=alert(1)> & "标签"', ' '];
    f.context.testTags = tags;
    f.run("patchMetaFor('fixture.png', '有标签', { tags: testTags });");
    let card = f.seed([{ file_name: '有标签', mes: 0 }]);
    assert.equal(card.querySelector('.cv-record-count').textContent, '0');
    assert.equal(card.querySelector('.cv-record-count').getAttribute('title'), '共 0 楼');
    assert.ok(card.querySelector('.cv-record-count svg'));
    assert.deepEqual(card.querySelectorAll('.cv-record-tag').map(tag => tag.textContent), tags.slice(0, 2));
    assert.equal(card.querySelector('.cv-record-tags img'), null);
    assert.equal(card.querySelectorAll('.cv-record-tags')[0].parentElement, card.querySelector('.cv-record-heading'));
    card = f.seed([{ file_name: '无标签', chat_items: 27 }]);
    assert.equal(card.querySelector('.cv-record-count').textContent, '27');
    assert.equal(card.querySelector('.cv-record-tags'), null);
    f.run("patchMetaFor('fixture.png', '旧数据', { tags: '不是数组' });");
    card = f.seed([{ file_name: '旧数据' }]);
    assert.equal(card.querySelector('.cv-record-count').textContent, '未知');
    assert.equal(card.querySelector('.cv-record-count').getAttribute('title'), '楼层数未知');
    assert.equal(card.querySelector('.cv-record-tags'), null);
});

test('the sleeve is the accessible return control and formats or escapes file sizes', () => {
    const f = fixture({ cardMotion: false });
    for (const [size, expected] of [[2048, '2 KB'], [0, '0 B'], [undefined, '未知'], ['<img src=x> & "KB"', '<img src=x> & "KB"']]) {
        const card = f.seed([{ file_name: '大小测试', file_size: size }]);
        const sleeve = card.querySelector('.cv-record-sleeve');
        assert.equal(sleeve.tagName, 'BUTTON');
        assert.equal(sleeve.getAttribute('data-act'), 'flip');
        assert.equal(sleeve.getAttribute('aria-label'), '翻回正面，查看故事');
        assert.equal(sleeve.querySelector('.cv-sleeve-letter').getAttribute('aria-hidden'), 'true');
        assert.equal(sleeve.querySelector('.cv-sleeve-size').textContent, expected);
        assert.equal(sleeve.querySelector('.cv-sleeve-size').getAttribute('title'), '文件大小：' + expected);
        assert.equal(sleeve.querySelector('img'), null);
        assert.ok(sleeve.querySelector('.cv-sleeve-size svg'));
        assert.equal(card.querySelector('.cv-record-flip'), null);
        assert.equal(card.querySelectorAll('.cv-record-secondary button').length, 1);
        f.click(card.querySelector('.cv-record-cover'));
        assert.equal(f.document.activeElement, sleeve);
        f.click(sleeve);
        settled(f, card, 'front');
        assert.equal(f.document.activeElement, card.querySelector('.cv-record-cover'));
    }
});

test('the shared bookmark works from either face and persists without flipping the card', () => {
    const f = fixture({ cardMotion: false });
    let card = f.seed();
    const bookmark = card.querySelector('.cv-record-bookmark');
    assert.equal(bookmark.parentElement, card);
    assert.equal(card.querySelectorAll('[data-act="star"]').length, 1);
    f.click(bookmark);
    access(card, 'front');
    assert.equal(bookmark.getAttribute('aria-pressed'), 'true');
    assert.equal(f.run("getMetaFor('fixture.png', '第一段故事').starred"), true);
    f.click(card.querySelector('.cv-record-cover'));
    f.click(bookmark);
    access(card, 'back');
    assert.equal(bookmark.getAttribute('aria-pressed'), 'false');
    assert.equal(bookmark.classList.contains('is-on'), false);
    f.click(bookmark);
    f.run('render();');
    card = f.document.querySelector('.cv-record');
    assert.equal(card.querySelector('.cv-record-bookmark').getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.cv-record-bookmark').classList.contains('is-on'), true);
});

test('mobile opening and viewport changes set the fallback layout and clean up the resize listener', () => {
    const f = fixture();
    const panel = f.document.getElementById('chatvault_panel');
    const overlay = f.document.getElementById('chatvault_overlay');
    const resizeListeners = new Set();
    f.context.window.addEventListener = (type, handler) => { if (type === 'resize') resizeListeners.add(handler); };
    f.context.window.removeEventListener = (type, handler) => { if (type === 'resize') resizeListeners.delete(handler); };
    f.run('isMobileLayout = () => true;');
    f.run("applyWindowState(panelEl, document.getElementById('chatvault_panel')); initWindowChrome(panelEl, document.getElementById('chatvault_panel'));");
    assert.equal(panel.classList.contains('cv-layout-narrow'), true);
    assert.equal(resizeListeners.size, 1);
    f.run('isMobileLayout = () => false;');
    panel.getBoundingClientRect = () => ({ width: 1200 });
    overlay._cvOnResize();
    assert.equal(panel.classList.contains('cv-layout-wide'), true);
    f.run('isMobileLayout = () => true;');
    overlay._cvOnResize();
    assert.equal(panel.classList.contains('cv-layout-narrow'), true);
    f.run('closePanel();');
    assert.equal(resizeListeners.size, 0);
});

test('flipping locks repeat actions and restores focus to the visible side', async () => {
    const f = fixture(), card = f.seed();
    f.click(card.querySelector('[data-act="flip"]'));
    access(card, 'none');
    const count = f.animations.length;
    f.click(card.querySelector('[data-act="flip"]'));
    f.click(card.querySelector('[data-act="star"]'));
    assert.equal(f.animations.length, count);
    assert.equal(card.querySelector('[data-act="star"]').getAttribute('aria-pressed'), 'false');
    f.animations.forEach(animation => animation.complete());
    await flush();
    settled(f, card);
    assert.equal(f.document.activeElement, card.querySelector('.cv-record-back [data-act="flip"]'));
});

test('closing during a flip cancels animation state and late callbacks stay harmless', async () => {
    const f = fixture(), card = f.seed();
    f.click(card.querySelector('[data-act="flip"]'));
    f.run('closePanel();');
    await flush();
    settled(f, card);
    assert.equal(card.isConnected, false);
    assert.equal(f.run('panelEl'), null);
    assert.equal(f.run('readerState.active'), false);
});

test('pagination during a flip cancels old cards and makes new cards usable', async () => {
    const f = fixture();
    const chats = Array.from({ length: 51 }, (_, n) => ({ file_name: '故事 ' + n, mes: n }));
    const card = f.seed(chats);
    f.click(card.querySelector('[data-act="flip"]'));
    f.click(f.document.getElementById('cv_next'));
    await flush();
    settled(f, card);
    assert.equal(card.isConnected, false);
    assert.equal(f.run('currentPage'), 2);
    const next = f.document.querySelector('.cv-record');
    assert.equal(f.document.querySelectorAll('.cv-record').length, 1);
    access(next, 'front');
    f.motion.matches = true;
    f.click(next.querySelector('.cv-record-cover'));
    settled(f, next);
    f.click(next.querySelector('[data-act="star"]'));
    assert.equal(next.querySelector('[data-act="star"]').getAttribute('aria-pressed'), 'true');
});

test('switching tabs during a flip clears locks without stealing external focus', async () => {
    const f = fixture(), card = f.seed();
    f.click(card.querySelector('[data-act="flip"]'));
    const outside = f.document.getElementById('cv_set_theme');
    outside.focus();
    f.run("switchTab('favorites');");
    await flush();
    settled(f, card);
    assert.equal(f.document.activeElement, outside);
    assert.equal(f.document.querySelector('.cv-record'), null);
});

test('reduced motion, disabled motion and missing animation API switch immediately', () => {
    for (const mode of ['reduced', 'disabled', 'unsupported']) {
        const f = fixture({ cardMotion: mode !== 'disabled' }), card = f.seed();
        f.motion.matches = mode === 'reduced';
        if (mode === 'unsupported') card.querySelector('.cv-record-turn').animate = undefined;
        f.click(card.querySelector('[data-act="flip"]'));
        settled(f, card);
        assert.equal(f.animations.length, 0);
    }
});

test('cancelled animations and the timeout fallback release the card', async () => {
    for (const reason of ['cancel', 'timeout', 'preference']) {
        const f = fixture(), card = f.seed();
        f.click(card.querySelector('[data-act="flip"]'));
        if (reason === 'cancel') f.animations.forEach(animation => animation.cancel());
        if (reason === 'timeout') [...f.timers.values()].forEach(fn => fn());
        if (reason === 'preference') { f.motion.matches = true; [...f.listeners].forEach(fn => fn()); }
        await flush();
        settled(f, card);
    }
});

test('theme changes persist, preserve cards and clear custom colors on return', async () => {
    const f = fixture({ customColors: { accent: '#123456', bgPanel: '#eeeeee' } }), card = f.seed();
    f.click(card.querySelector('[data-act="flip"]'));
    f.run('openVaultSettingsModal();');
    for (const theme of ['light', 'coffee', 'custom', 'dark']) {
        const button = f.document.querySelector('[data-theme="' + theme + '"]');
        f.click(button);
        assert.equal(f.run('loadSettings().theme'), theme);
        for (const id of ['chatvault_overlay', 'chatvault_settings']) {
            assert.equal(f.document.getElementById(id).className, 'cv-theme-' + theme);
        }
        assert.equal(f.document.getElementById('cv_set_theme').value, theme);
        const css = f.document.getElementById('cv-custom-colors-style').textContent;
        theme === 'custom' ? assert.match(css, /#123456/) : assert.equal(css, '');
        assert.equal(f.document.querySelector('.cv-record'), card);
        assert.equal(button.getAttribute('aria-pressed'), 'true');
    }
    f.document.getElementById('cv_appearance_motion').onchange({ target: { checked: false } });
    await flush();
    settled(f, card);
    assert.equal(f.run('loadSettings().cardMotion'), false);
});

test('dialogue and thought styles preserve inline formatting and literal custom markers', () => {
    const f = fixture();
    f.context.input = '<p>“你好<strong>朋友</strong>” <em>心里话</em> [.*想法.*] 【对话】</p>';
    f.context.cfg = { readerThoughtOpen: '[.*', readerThoughtClose: '.*]', readerDialogueOpen: '【', readerDialogueClose: '】' };
    const root = f.document.createElement('div');
    root.innerHTML = f.run('styleReaderHtml(input, cfg)');
    assert.equal(root.textContent, '“你好朋友” 心里话 [.*想法.*] 【对话】');
    assert.equal(root.querySelector('strong .cv-dialogue').textContent, '朋友');
    assert.equal(root.querySelector('em').classList.contains('cv-thought'), true);
    assert.equal(root.querySelector('span.cv-thought').textContent, '[.*想法.*]');
    assert.equal(root.querySelectorAll('.cv-dialogue').at(-1).textContent, '【对话】');
});

test('code, links, separate paragraphs and incomplete pairs remain unstyled', () => {
    const f = fixture();
    f.context.input = '<p>“未闭合</p><p>另一个段落”</p><pre><code>“代码”</code></pre><p><a href="/">“链接”</a> 【未成对】</p>';
    f.context.cfg = { readerDialogueOpen: '【', readerDialogueClose: '' };
    assert.equal(f.run('styleReaderHtml(input, cfg)'), f.context.input);
    f.context.input = '<p>“对话” <em>心里话</em></p>';
    assert.equal(f.run('styleReaderHtml(input, { readerTextStyles: false })'), f.context.input);
});

test('reader color refresh changes styles without resetting reading position or source text', () => {
    const f = fixture({ readerRichRender: false, readerDialogueColor: '#123456', readerThoughtColor: '#abcdef' });
    f.document.getElementById('cv_body').innerHTML = '<div class="cv-reader-stage"><div class="cv-reader-msg" data-mes-idx="0"><div class="cv-reader-msg-body"></div></div></div>';
    const stage = f.document.querySelector('.cv-reader-stage');
    stage.scrollTop = 375;
    f.run('readerState._processed = [{ idx: 0, text: \'“对话” *心里话*\' }]; refreshReaderTextStyles();');
    assert.equal(stage.style['--cv-reader-dialogue-color'], '#123456');
    assert.equal(stage.style['--cv-reader-thought-color'], '#abcdef');
    assert.ok(stage.querySelector('.cv-dialogue'));
    assert.ok(stage.querySelector('.cv-thought'));
    f.run("saveSettings({ ...loadSettings(), readerTextStyles: false, readerDialogueColor: '', readerThoughtColor: '' }); refreshReaderTextStyles();");
    assert.equal(stage.style['--cv-reader-dialogue-color'], undefined);
    assert.equal(stage.style['--cv-reader-thought-color'], undefined);
    assert.equal(stage.querySelector('.cv-dialogue'), null);
    assert.equal(stage.scrollTop, 375);
    assert.equal(f.run('readerState._processed[0].text'), '“对话” *心里话*');
    assert.equal(f.run("readerTextColors({ readerDialogueColor: 'red; display:none' }).dialogue"), '');
});
