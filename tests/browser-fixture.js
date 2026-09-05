/* Browser fixture only. Isolated in-memory storage and synthetic read responses. */
const fixtureStorage = new Map();
Object.defineProperty(window, 'localStorage', { value: {
    getItem: key => fixtureStorage.get(key) ?? null,
    setItem: (key, value) => fixtureStorage.set(key, String(value)),
    removeItem: key => fixtureStorage.delete(key),
} });
window.jQuery = () => {}; // Skip real extension startup and injection.
const fixtureCharacters = [
    { name: '林间来信', avatar: 'portrait.svg' },
    { name: '海边电台', avatar: 'landscape.svg' },
    { name: '封面失效', avatar: 'missing.svg' },
    { name: '无封面', avatar: '' },
];
const fixtureTitles = [
    '雨停之前',
    '把漫长的夏天写成一封寄往海边的信——这是一个需要完整显示的长标题',
    '封面失效时，故事仍然可读',
    '没有封面的旧日手记',
];
const fixtureChats = Object.fromEntries(fixtureCharacters.map((character, i) => [character.avatar, [
    { file_name: fixtureTitles[i], mes: 4, last_mes: 1788564000000 - i * 1000 },
]]));
function fixtureMessages(name) {
    return [
        { chat_metadata: {} },
        { name, is_user: false, mes: '窗外的雨落在信封上。\n\n“你还记得那个夏天吗？”\n\n*如果能再见一次，我会把没说完的话说完。*' },
        { name: '读者', is_user: true, mes: '“当然记得。”\n\n我把旧照片翻到背面，那里写着我们约好的日期。' },
        { name, is_user: false, mes: '“那就从这里重新开始。”\n\n*这一次，不必急着赶路。*\n\n树影落在书页之间，远处的电台仍在播放那首歌。' },
        { name, is_user: false, mes: '傍晚的最后一束光穿过窗帘，在旧书页上停留了很久。我们把故事写在这里，也把尚未说出口的话留给下一次见面。街角的灯已经亮起，海风从很远的地方吹来。' },
    ];
}
window.SillyTavern = { getContext: () => ({ characters: fixtureCharacters, characterId: 0, chatId: fixtureTitles[0] }) };
window.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, message => {
    document.getElementById('fixture-note').textContent = '本地合成数据 · ' + message;
}]));
window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), location.href);
    if (url.origin !== location.origin) throw new Error('External requests are disabled in this fixture');
    const data = JSON.parse(options.body || '{}');
    let result;
    if (url.pathname === '/api/characters/all') result = fixtureCharacters;
    else if (url.pathname === '/api/characters/chats') result = fixtureChats[data.avatar_url] || [];
    else if (url.pathname === '/api/chats/get') result = fixtureMessages(data.ch_name || '林间来信');
    else throw new Error('This fixture provides synthetic read APIs only: ' + url.pathname);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
