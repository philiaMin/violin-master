/* 바이올린 마스터 전체 백업 · 복원
   네 앱의 기기 저장(악보·보잉·세트리스트·템포 = 'violin-sheets', 녹음 = 'vm-recordings', 설정 = localStorage 'vm:'·'vm-sheets:')을
   파일 하나(.vmbackup)로 묶고, 다른 기기(아이패드 등)에서 그대로 풀어요.
   파일 모양: 'VMBK1\n' + 머리말 길이(4바이트) + 머리말 JSON + 소리·그림 같은 바이너리를 이어 붙인 것.
   머리말 안에서 바이너리는 { __b: [시작, 길이] }로 가리켜요. 첫 화면과 악보 앱이 함께 써요. */
(() => {
  'use strict';
  const MAGIC = 'VMBK1\n';
  const DBS = [
    { name: 'violin-sheets', label: '악보' },
    { name: 'vm-recordings', label: '녹음', optional: true }
  ];
  const LS_PREFIX = ['vm:', 'vm-sheets:'];

  const openDb = (name, create) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onupgradeneeded = () => { if (!create) r.transaction.abort(); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
    r.onblocked = () => rej(new Error('다른 탭에서 앱이 열려 있어요. 다른 탭을 닫고 다시 해 주세요'));
  });
  const done = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('저장하지 못했어요')); });

  // 값 안의 ArrayBuffer·Blob을 꺼내 bins에 넣고 자리표로 바꿔요
  async function pack(v, bins) {
    if (v instanceof ArrayBuffer) { bins.push(v); return { __b: bins.length - 1 }; }
    if (ArrayBuffer.isView(v)) { bins.push(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)); return { __b: bins.length - 1 }; }
    if (v instanceof Blob) { bins.push(await v.arrayBuffer()); return { __b: bins.length - 1, __type: v.type, __blob: 1 }; }
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await pack(x, bins)); return o; }
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await pack(v[k], bins); return o; }
    return v;
  }
  function unpack(v, data) {
    if (Array.isArray(v)) return v.map(x => unpack(x, data));
    if (v && typeof v === 'object') {
      if (Array.isArray(v.__b)) { const b = data.slice(v.__b[0], v.__b[0] + v.__b[1]); return v.__blob ? new Blob([b], { type: v.__type || '' }) : b; }
      const o = {}; for (const k of Object.keys(v)) o[k] = unpack(v[k], data); return o;
    }
    return v;
  }

  async function dumpDb(name, skip, bins, onRow) {
    const d = await openDb(name, false); if (!d) return null;
    const out = { name, version: d.version, stores: [] };
    try {
      for (const sn of d.objectStoreNames) {
        if (skip?.(sn)) continue;
        const t = d.transaction(sn), s = t.objectStore(sn);
        const st = { name: sn, keyPath: s.keyPath, autoIncrement: s.autoIncrement, rows: [] };
        const raw = await new Promise((res, rej) => {
          const rows = [], c = s.openCursor();
          c.onsuccess = () => { const cur = c.result; if (!cur) return res(rows); rows.push([cur.primaryKey, cur.value]); cur.continue(); };
          c.onerror = () => rej(c.error);
        });
        for (const [k, v] of raw) { st.rows.push({ k: s.keyPath == null ? k : undefined, v: await pack(v, bins) }); onRow?.(); }
        out.stores.push(st);
      }
    } finally { d.close(); }
    return out;
  }

  // 지금 이 기기에 있는 것 세기
  async function summary() {
    const count = async (db, st) => { const d = await openDb(db, false); if (!d) return 0; try { if (!d.objectStoreNames.contains(st)) return 0; const t = d.transaction(st), q = t.objectStore(st).count(); await done(t); return q.result; } finally { d.close(); } };
    let used = 0; try { used = (await navigator.storage?.estimate?.())?.usage || 0; } catch {}
    return { scores: await count('violin-sheets', 'scores'), recs: await count('vm-recordings', 'recs'), used, lastAt: +(localStorage.getItem('vm:last-backup') || 0) };
  }

  // 백업 파일(Blob) 만들기
  async function make({ withRecs = true, onProgress } = {}) {
    const bins = [];
    let n = 0; const tick = () => { if (++n % 20 === 0) onProgress?.(n); };
    const dbs = [];
    for (const db of DBS) {
      if (db.name === 'vm-recordings' && !withRecs) continue;
      const x = await dumpDb(db.name, null, bins, tick); if (x) dbs.push(x);
    }
    const local = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (LS_PREFIX.some(p => k.startsWith(p)) && k !== 'vm:last-backup') local[k] = localStorage.getItem(k); }
    // 바이너리 자리 계산
    let off = 0; const pos = bins.map(b => { const p = [off, b.byteLength]; off += b.byteLength; return p; });
    const fix = v => Array.isArray(v) ? v.map(fix) : v && typeof v === 'object' ? (typeof v.__b === 'number' ? { ...v, __b: pos[v.__b] } : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]))) : v;
    const head = { app: 'violin-master-backup', v: 1, at: Date.now(), from: navigator.userAgent.slice(0, 120), withRecs, dbs: fix(dbs), local };
    const hb = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, hb.byteLength, true);
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const blob = new Blob([MAGIC, len, hb, ...bins], { type: 'application/octet-stream' });
    return { blob, name: `ViolinMaster-backup-${stamp}.vmbackup`, head };
  }

  // 아이패드·아이폰: 공유 창 → "파일에 저장" → iCloud Drive. 안 되면 내려받기.
  async function save({ blob, name }) {
    const file = new File([blob], name, { type: 'application/octet-stream' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); markSaved(); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    markSaved(); return 'downloaded';
  }
  const markSaved = () => { try { localStorage.setItem('vm:last-backup', String(Date.now())); } catch {} };

  async function readHead(file) {
    const buf = await file.arrayBuffer();
    const magic = new TextDecoder().decode(buf.slice(0, MAGIC.length));
    if (magic === MAGIC) {
      const len = new DataView(buf, MAGIC.length, 4).getUint32(0, true), start = MAGIC.length + 4;
      const head = JSON.parse(new TextDecoder().decode(buf.slice(start, start + len)));
      if (head.app !== 'violin-master-backup') throw new Error('바이올린 마스터 백업 파일이 아니에요');
      return { kind: 'full', head, data: buf.slice(start + len) };
    }
    // 예전 악보 앱 백업(.json)도 받아요
    try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j.app === 'violin-master-sheets') return { kind: 'sheets-json', head: j }; } catch {}
    throw new Error('바이올린 마스터 백업 파일이 아니에요');
  }

  // 복원: 이 기기에 없는 것만 더해요(이미 있는 악보·녹음은 그대로 둠)
  async function restore(file, { onProgress } = {}) {
    const r = await readHead(file);
    if (r.kind === 'sheets-json') return restoreSheetsJson(r.head);
    const { head, data } = r, added = {};
    for (const db of head.dbs) {
      // 백업과 같은 버전으로 열어요(새 기기면 이때 저장 칸을 만들어요). 이 기기가 더 새 버전이면 그대로 열어요.
      const mk = q => { for (const s of db.stores) if (!q.result.objectStoreNames.contains(s.name)) q.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: !!s.autoIncrement }); };
      const opn = ver => new Promise((res, rej) => {
        const q = ver ? indexedDB.open(db.name, ver) : indexedDB.open(db.name);
        q.onupgradeneeded = () => mk(q);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
        q.onblocked = () => rej(new Error('다른 탭에서 앱이 열려 있어요. 다른 탭을 닫고 다시 해 주세요'));
      });
      let cur;
      try { cur = await opn(db.version); } catch (e) { if (e?.name !== 'VersionError') throw e; cur = await opn(); }
      if (db.stores.some(s => !cur.objectStoreNames.contains(s.name))) { const v = cur.version + 1; cur.close(); cur = await opn(v); }
      try {
        for (const s of db.stores) {
          const t = cur.transaction(s.name, 'readwrite'), os = t.objectStore(s.name); let n = 0;
          for (const row of s.rows) {
            const v = unpack(row.v, data), key = os.keyPath == null ? row.k : undefined;
            const exists = os.getKey ? os.getKey(key ?? v[os.keyPath]) : os.count(key ?? v[os.keyPath]);
            exists.onsuccess = () => { const has = os.getKey ? exists.result !== undefined : exists.result > 0; if (!has) { key === undefined ? os.put(v) : os.put(v, key); n++; } };
          }
          await done(t);
          added[`${db.name}/${s.name}`] = n; onProgress?.(s.name);
        }
      } finally { cur.close(); }
    }
    let settings = 0;
    for (const [k, v] of Object.entries(head.local || {})) if (localStorage.getItem(k) == null) { try { localStorage.setItem(k, v); settings++; } catch {} }
    try { await navigator.storage?.persist?.(); } catch {}
    try { if (head.at > +(localStorage.getItem('vm:last-backup') || 0)) localStorage.setItem('vm:last-backup', String(head.at)); } catch {}
    return { scores: added['violin-sheets/scores'] || 0, recs: added['vm-recordings/recs'] || 0, settings, at: head.at };
  }

  // 예전 악보 앱의 .json 백업
  async function restoreSheetsJson(b) {
    const d = await new Promise((res, rej) => {
      const q = indexedDB.open('violin-sheets', 2);
      q.onupgradeneeded = () => { const want = { scores: { keyPath: 'id' }, files: undefined, thumbs: { keyPath: 'id' }, setlists: { keyPath: 'id' }, marks: { keyPath: 'id' } }; for (const [n, o] of Object.entries(want)) if (!q.result.objectStoreNames.contains(n)) q.result.createObjectStore(n, o); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    const ab = async u => (await fetch(u)).arrayBuffer();
    let n = 0;
    try {
      const have = await new Promise(res => { const t = d.transaction('scores'), q = t.objectStore('scores').getAllKeys(); q.onsuccess = () => res(new Set(q.result)); });
      for (const s of b.scores || []) {
        if (have.has(s.id) || !b.files?.[s.id]) continue;
        const parts = await Promise.all(b.files[s.id].map(async p => ({ name: p.name, type: p.type, data: await ab(p.data) })));
        const thumb = b.thumbs?.[s.id] ? { id: s.id, type: 'image/jpeg', data: await ab(b.thumbs[s.id]) } : null;
        const mk = (b.marks || []).find(m => m.id === s.id);
        const t = d.transaction(['scores', 'files', 'thumbs', 'marks'], 'readwrite');
        t.objectStore('files').put(parts, s.id); if (thumb) t.objectStore('thumbs').put(thumb); if (mk) t.objectStore('marks').put(mk); t.objectStore('scores').put(s);
        await done(t); n++;
      }
      const t = d.transaction('setlists', 'readwrite'), os = t.objectStore('setlists');
      for (const l of b.setlists || []) { const g = os.count(l.id); g.onsuccess = () => { if (!g.result) os.put(l); }; }
      await done(t);
    } finally { d.close(); }
    return { scores: n, recs: 0, settings: 0, at: b.exportedAt || 0 };
  }

  // 아이폰·아이패드인지, 홈 화면 앱으로 열었는지
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  window.VMBackup = { summary, make, save, restore, readHead, isIOS, standalone };
})();
