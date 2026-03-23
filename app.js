// CP7 Lookup — CODU
// Unified search: 197K CP7 + 37K OSM places + 241K streets
// Fuzzy match with trigram index

(function() {
  'use strict';

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const clearBtn = document.getElementById('clearBtn');
  const resultCard = document.getElementById('resultCard');
  const copyBtn = document.getElementById('copyBtn');

  // Data stores
  let postalEntries = null;
  let postalIndex = null;     // Map<cp7, entry>
  let textIndex = null;       // Map<normName, [entries]>
  let placesEntries = null;   // OSM places
  let placesIndex = null;     // Map<normName, [entries]>
  let streetsEntries = null;  // CTT streets
  let streetsIndex = null;    // Map<normStreet, [entries]>

  // Trigram index for fuzzy search
  let trigramIndex = null;    // Map<trigram, Set<normName>>

  function normalizeStr(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function getTrigrams(str) {
    const s = '  ' + str + '  ';
    const tris = new Set();
    for (let i = 0; i < s.length - 2; i++) {
      tris.add(s.substring(i, i + 3));
    }
    return tris;
  }

  function ensureParsed() {
    if (postalEntries) return;
    const t0 = performance.now();

    // 1. Parse CP7
    if (typeof POSTAL_DATA !== 'undefined') {
      const lines = POSTAL_DATA.split('\n');
      postalEntries = new Array(lines.length);
      postalIndex = new Map();
      textIndex = new Map();
      for (let i = 0; i < lines.length; i++) {
        const p = lines[i].split('|');
        const entry = { cp7: p[0], name: p[1], lat: parseFloat(p[2]), lon: parseFloat(p[3]),
          distrito: p[4]||'', concelho: p[5]||'', localidade: p[6]||'', type: 'cp' };
        postalEntries[i] = entry;
        postalIndex.set(entry.cp7, entry);
        const norm = normalizeStr(entry.name);
        if (!textIndex.has(norm)) textIndex.set(norm, []);
        textIndex.get(norm).push(entry);
      }
    }

    // 2. Parse OSM places
    if (typeof PLACES_DATA !== 'undefined') {
      const lines = PLACES_DATA.split('\n');
      placesEntries = new Array(lines.length);
      placesIndex = new Map();
      for (let i = 0; i < lines.length; i++) {
        const p = lines[i].split('|');
        const entry = { name: p[0], placeType: p[1], lat: parseFloat(p[2]), lon: parseFloat(p[3]), type: 'place' };
        placesEntries[i] = entry;
        const norm = normalizeStr(entry.name);
        if (!placesIndex.has(norm)) placesIndex.set(norm, []);
        placesIndex.get(norm).push(entry);
      }
    }

    // 3. Parse OSM streets (name|lat|lon)
    if (typeof STREETS_DATA !== 'undefined') {
      const lines = STREETS_DATA.split('\n');
      streetsEntries = new Array(lines.length);
      streetsIndex = new Map();
      for (let i = 0; i < lines.length; i++) {
        const p = lines[i].split('|');
        const entry = { street: p[0], lat: parseFloat(p[1]), lon: parseFloat(p[2]), type: 'street' };
        streetsEntries[i] = entry;
        const norm = normalizeStr(entry.street);
        if (!streetsIndex.has(norm)) streetsIndex.set(norm, []);
        streetsIndex.get(norm).push(entry);
      }
    }

    // 4. Build trigram index for fuzzy (places + CP names + unique streets)
    trigramIndex = new Map();
    const allNames = new Set();
    if (textIndex) for (const k of textIndex.keys()) allNames.add(k);
    if (placesIndex) for (const k of placesIndex.keys()) allNames.add(k);
    if (streetsIndex) for (const k of streetsIndex.keys()) allNames.add(k);
    
    for (const name of allNames) {
      const tris = getTrigrams(name);
      for (const tri of tris) {
        if (!trigramIndex.has(tri)) trigramIndex.set(tri, new Set());
        trigramIndex.get(tri).add(name);
      }
    }

    console.log(`Parsed in ${(performance.now()-t0).toFixed(0)}ms: ${postalEntries?.length||0} CP7, ${placesEntries?.length||0} places, ${streetsEntries?.length||0} streets, ${trigramIndex.size} trigrams`);
  }

  // Map
  const map = L.map('map', { center: [39.7, -8.2], zoom: 7, zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  }).addTo(map);

  let currentMarker = null;
  let currentCircle = null;

  function placeMarker(lat, lon, label) {
    if (currentMarker) map.removeLayer(currentMarker);
    if (currentCircle) map.removeLayer(currentCircle);
    currentCircle = L.circle([lat, lon], { radius: 100, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 0.12, weight: 1.5, dashArray: '4 4' }).addTo(map);
    const icon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#e74c3c;border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(231,76,60,0.5)"></div>', iconSize: [14,14], iconAnchor: [7,7] });
    currentMarker = L.marker([lat, lon], { icon }).addTo(map);
    currentMarker.bindTooltip(label, { permanent: true, direction: 'top', offset: [0,-10], className: 'cp-tooltip' });
    map.flyTo([lat, lon], 14, { duration: 0.8 });
  }

  // Type labels in Portuguese
  const placeTypeLabels = {
    city: 'Cidade', town: 'Vila', village: 'Aldeia/Vila', hamlet: 'Lugar',
    isolated_dwelling: 'Habitação Isolada', locality: 'Localidade',
    farm: 'Quinta/Monte', neighbourhood: 'Bairro', suburb: 'Subúrbio', quarter: 'Bairro'
  };

  // Show result card
  function showResult(item) {
    let lat, lon, name, cp7val = '', distrito = '', concelho = '', localidade = '', streets = [];

    if (item.type === 'cp') {
      lat = item.lat; lon = item.lon; name = item.name;
      cp7val = item.cp7; distrito = item.distrito; concelho = item.concelho; localidade = item.localidade;
    } else if (item.type === 'place') {
      lat = item.lat; lon = item.lon; name = item.name;
    } else if (item.type === 'street') {
      lat = item.lat; lon = item.lon;
      name = item.street;
    }

    document.getElementById('resultCP').textContent = cp7val || '—';
    document.getElementById('resultCP').style.display = cp7val ? '' : 'none';
    document.getElementById('resultName').textContent = name;
    document.getElementById('resultCoords').textContent = `${lat}, ${lon}`;
    document.getElementById('resultDistrito').textContent = distrito || '—';
    document.getElementById('resultConcelho').textContent = concelho || '—';
    document.getElementById('resultLocalidade').textContent = localidade || '—';

    // Streets section — show nearby OSM streets for CP7 lookups
    const streetsEl = document.getElementById('resultStreets');
    const streetsSection = document.getElementById('streetsSection');
    if (item.type === 'cp' && streetsIndex) {
      const nearby = [];
      for (const [, entries] of streetsIndex) {
        for (const e of entries) {
          const dlat = e.lat - lat, dlon = e.lon - lon;
          if (dlat*dlat + dlon*dlon < 0.0004) { // ~2km
            nearby.push(e.street);
          }
        }
        if (nearby.length >= 20) break;
      }
      if (nearby.length > 0) {
        const unique = [...new Set(nearby)].sort().slice(0, 15);
        streetsEl.innerHTML = unique.map(s => `<li>${s}</li>`).join('');
        document.getElementById('streetsCount').textContent = `${unique.length} rua${unique.length > 1 ? 's' : ''} próximas`;
        streetsSection.classList.remove('hidden');
      } else {
        streetsSection.classList.add('hidden');
      }
    } else {
      streetsSection.classList.add('hidden');
    }

    resultCard.classList.remove('hidden');
    placeMarker(lat, lon, cp7val ? `${cp7val} — ${name}` : name);
  }

  // Fuzzy search using trigrams
  function fuzzySearch(query, maxResults) {
    const qNorm = normalizeStr(query);
    const qTrigrams = getTrigrams(qNorm);
    if (qTrigrams.size === 0) return [];

    // Score each name by trigram overlap
    const scores = new Map();
    for (const tri of qTrigrams) {
      const names = trigramIndex.get(tri);
      if (!names) continue;
      for (const name of names) {
        scores.set(name, (scores.get(name) || 0) + 1);
      }
    }

    // Compute Jaccard-like similarity
    const results = [];
    for (const [name, hits] of scores) {
      const nameTris = getTrigrams(name);
      const union = new Set([...qTrigrams, ...nameTris]).size;
      const similarity = hits / union;
      if (similarity > 0.15) {
        results.push({ name, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  // Build searchable text for each entry (called once per entry type)
  // Returns: { text: "NORMALIZED SEARCHABLE STRING", cp4: "1234" or null }
  function buildSearchText(item) {
    if (item.type === 'cp') {
      return `${item.cp7} ${item.name} ${item.distrito} ${item.concelho} ${item.localidade}`;
    } else if (item.type === 'place') {
      return item.name;
    } else if (item.type === 'street') {
      return item.street;
    }
    return '';
  }

  // Multi-token scoring: each query token that matches adds to score
  function scoreEntry(tokens, searchText, cp4Token) {
    let score = 0;
    for (const tok of tokens) {
      if (searchText.includes(tok)) {
        score += tok.length; // longer token matches = higher score
      }
    }
    // Bonus for CP4 match
    if (cp4Token && searchText.includes(cp4Token)) {
      score += 10;
    }
    return score;
  }

  // Main search — unified multi-token across all databases
  function search(query) {
    ensureParsed();
    const q = query.trim();
    if (q.length < 2) { searchResults.innerHTML = ''; return; }

    // Check if pure postal code pattern (only digits + optional dash)
    const pureCpMatch = q.match(/^(\d{4})(?:[-\s]?(\d{0,3}))?$/);
    if (pureCpMatch) {
      const results = [];
      const prefix = pureCpMatch[2] ? `${pureCpMatch[1]}-${pureCpMatch[2]}` : pureCpMatch[1];
      for (let i = 0; i < postalEntries.length && results.length < 12; i++) {
        if (postalEntries[i].cp7.startsWith(prefix)) {
          results.push(postalEntries[i]);
        }
      }
      renderResults(results, 'cp');
      return;
    }

    // Tokenize query: split by spaces, commas, hyphens
    const rawTokens = q.replace(/[,;]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
    const tokens = rawTokens.map(t => normalizeStr(t));
    if (tokens.length === 0) { searchResults.innerHTML = ''; return; }

    // Extract CP4 token if any (4 digits)
    let cp4Token = null;
    for (const t of rawTokens) {
      const m = t.match(/^(\d{4})$/);
      if (m) { cp4Token = m[1]; break; }
    }

    const scored = []; // { item, score }
    const MAX_CANDIDATES = 50;

    // Score CP7 entries
    if (textIndex) {
      for (const [normName, entries] of textIndex) {
        const e = entries[0];
        const searchText = normalizeStr(`${e.cp7} ${e.name} ${e.distrito} ${e.concelho} ${e.localidade}`);
        const score = scoreEntry(tokens, searchText, cp4Token);
        if (score > 0) {
          scored.push({ item: { ...e, source: 'cp' }, score });
        }
      }
    }

    // Score places
    if (placesIndex) {
      for (const [normName, entries] of placesIndex) {
        const e = entries[0];
        const score = scoreEntry(tokens, normName, null);
        if (score > 0) {
          scored.push({ item: { ...e, source: 'place' }, score });
        }
      }
    }

    // Build context tokens: resolve place names and CP4 to coordinates
    let contextLat = null, contextLon = null;
    const textTokens = tokens.filter(t => !/^\d+$/.test(t));
    
    // Try to resolve context from non-street tokens (place names, CP4)
    if (cp4Token && postalIndex) {
      // Find centroid of CP4 area
      for (const [cp7key, cpEntry] of postalIndex) {
        if (cp7key.startsWith(cp4Token)) {
          contextLat = cpEntry.lat; contextLon = cpEntry.lon;
          break;
        }
      }
    }
    // Check if any token resolves to a known place (for geographic context)
    if (!contextLat && textTokens.length > 0) {
      // Try longest tokens first (more specific)
      const sortedTokens = [...textTokens].sort((a, b) => b.length - a.length);
      for (const tok of sortedTokens) {
        if (tok.length < 3) continue;
        // Exact match first, then startsWith
        if (placesIndex) {
          const exactPlace = placesIndex.get(tok);
          if (exactPlace) { contextLat = exactPlace[0].lat; contextLon = exactPlace[0].lon; break; }
          for (const [pName, pEntries] of placesIndex) {
            if (pName.startsWith(tok) && tok.length >= 4) {
              contextLat = pEntries[0].lat; contextLon = pEntries[0].lon; break;
            }
          }
          if (contextLat) break;
        }
        if (!contextLat && textIndex) {
          const exactCp = textIndex.get(tok);
          if (exactCp) { contextLat = exactCp[0].lat; contextLon = exactCp[0].lon; break; }
          for (const [cName, cEntries] of textIndex) {
            if (cName.startsWith(tok) && tok.length >= 4) {
              contextLat = cEntries[0].lat; contextLon = cEntries[0].lon; break;
            }
          }
          if (contextLat) break;
        }
      }
    }

    // Score streets — with proximity bonus to resolved context
    if (streetsIndex) {
      for (const [normName, entries] of streetsIndex) {
        const baseScore = scoreEntry(tokens, normName, null);
        if (baseScore === 0) continue;
        
        let bestScore = baseScore;
        let bestEntry = entries[0];
        
        // If we have context coords, find the street entry closest to context
        if (contextLat && entries.length > 0) {
          let minDist = Infinity;
          for (const e of entries) {
            const dlat = e.lat - contextLat, dlon = e.lon - contextLon;
            const dist = dlat*dlat + dlon*dlon;
            if (dist < minDist) {
              minDist = dist;
              bestEntry = e;
            }
          }
          // Proximity bonus (closer = higher bonus)
          if (minDist < 0.005) bestScore += 15; // <7km
          else if (minDist < 0.02) bestScore += 8; // <15km
          else if (minDist < 0.05) bestScore += 3; // <25km
        }
        
        scored.push({ item: { ...bestEntry, source: 'street' }, score: bestScore });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Deduplicate and take top results
    const results = [];
    const seen = new Set();
    for (const { item } of scored) {
      const key = item.type === 'street' ? `${item.street}|${item.lat}` :
                  item.type === 'cp' ? item.cp7 : `${item.name}|${item.lat}`;
      if (!seen.has(key) && results.length < 12) {
        seen.add(key);
        results.push(item);
      }
    }

    // If few results, try fuzzy
    if (results.length < 4 && q.length >= 3) {
      const fuzzy = fuzzySearch(q, 8);
      for (const f of fuzzy) {
        const pm = placesIndex?.get(f.name);
        const cm = textIndex?.get(f.name);
        const sm = streetsIndex?.get(f.name);
        let item = null;
        if (pm) item = { ...pm[0], source: 'place', fuzzy: true };
        else if (cm) item = { ...cm[0], source: 'cp', fuzzy: true };
        else if (sm) item = { ...sm[0], source: 'street', fuzzy: true };
        if (item) {
          const key = item.type === 'street' ? `${item.street}|${item.lat}` :
                      item.type === 'cp' ? item.cp7 : `${item.name}|${item.lat}`;
          if (!seen.has(key) && results.length < 12) {
            seen.add(key);
            results.push(item);
          }
        }
      }
    }

    renderResults(results, 'text');
  }

  // Render
  function renderResults(results, mode) {
    searchResults.innerHTML = '';
    results.forEach((item, idx) => {
      const li = document.createElement('li');
      if (item.type === 'cp' || item.source === 'cp') {
        li.innerHTML = `<span class="result-main">${item.cp7}</span>
          <span class="result-sub">${item.name} · ${item.concelho || ''}</span>
          <span class="result-type">${item.fuzzy ? '≈ ' : ''}Código Postal</span>`;
      } else if (item.type === 'place' || item.source === 'place') {
        const typeLabel = placeTypeLabels[item.placeType] || item.placeType || 'Local';
        li.innerHTML = `<span class="result-main">${item.name}</span>
          <span class="result-sub">${typeLabel}</span>
          <span class="result-type">${item.fuzzy ? '≈ ' : ''}Lugar OSM</span>`;
      } else if (item.type === 'street' || item.source === 'street') {
        li.innerHTML = `<span class="result-main">${item.street}</span>
          <span class="result-sub">${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}</span>
          <span class="result-type">${item.fuzzy ? '≈ ' : ''}Rua OSM</span>`;
      }
      li.addEventListener('click', () => {
        showResult(item);
        searchResults.innerHTML = '';
        const displayName = item.type === 'street' || item.source === 'street'
          ? item.street
          : item.type === 'cp' || item.source === 'cp'
          ? `${item.cp7} — ${item.name}`
          : item.name;
        searchInput.value = displayName;
      });
      if (idx === 0) li.classList.add('active');
      searchResults.appendChild(li);
    });
  }

  // Debounced input
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearBtn.classList.toggle('visible', searchInput.value.length > 0);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => search(searchInput.value), 100);
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('li');
    if (!items.length) return;
    const current = searchResults.querySelector('li.active');
    let idx = Array.from(items).indexOf(current);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (current) current.classList.remove('active');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (current) current.classList.remove('active');
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) current.click();
    } else if (e.key === 'Escape') {
      searchResults.innerHTML = '';
      searchInput.blur();
    }
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchResults.innerHTML = '';
    resultCard.classList.add('hidden');
    clearBtn.classList.remove('visible');
    if (currentMarker) map.removeLayer(currentMarker);
    if (currentCircle) map.removeLayer(currentCircle);
    map.flyTo([39.7, -8.2], 7, { duration: 0.5 });
    searchInput.focus();
  });

  // Copy coordinates
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta); showCopied();
  }
  function showCopied() {
    copyBtn.classList.add('copied');
    setTimeout(() => copyBtn.classList.remove('copied'), 2000);
  }
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    copyToClipboard(document.getElementById('resultCoords').textContent);
  });

  // Tooltip style
  const style = document.createElement('style');
  style.textContent = `
    .cp-tooltip { background:rgba(15,17,23,0.92)!important; border:1px solid #333742!important; color:#e4e5e8!important;
      font-family:'JetBrains Mono',monospace!important; font-size:12px!important; font-weight:600!important;
      padding:4px 10px!important; border-radius:6px!important; box-shadow:0 4px 12px rgba(0,0,0,0.4)!important; }
    .cp-tooltip::before { border-top-color:rgba(15,17,23,0.92)!important; }
  `;
  document.head.appendChild(style);

})();
