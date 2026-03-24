// CP7 Lookup v2 — CODU
// CP7: 197K offline | Streets/Places: Photon + Nominatim geocoder

(function() {
  'use strict';

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const searchStatus = document.getElementById('searchStatus');
  const clearBtn = document.getElementById('clearBtn');
  const resultCard = document.getElementById('resultCard');
  const copyBtn = document.getElementById('copyBtn');

  // ─── Theme toggle ─────────────────────────────────────
  const themeBtn = document.querySelector('[data-theme-toggle]');
  let currentTheme = 'dark';
  themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    // Swap map tiles
    if (currentTheme === 'dark') {
      map.removeLayer(tileLight);
      tileDark.addTo(map);
    } else {
      map.removeLayer(tileDark);
      tileLight.addTo(map);
    }
  });

  // ─── CP7 data (offline) ───────────────────────────────
  let postalEntries = null;
  let postalIndex = null;

  function normalizeStr(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function ensureParsed() {
    if (postalEntries) return;
    if (typeof POSTAL_DATA === 'undefined') return;
    const t0 = performance.now();
    const lines = POSTAL_DATA.split('\n');
    postalEntries = new Array(lines.length);
    postalIndex = new Map();
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i].split('|');
      const entry = {
        cp7: p[0], name: p[1], lat: parseFloat(p[2]), lon: parseFloat(p[3]),
        distrito: p[4]||'', concelho: p[5]||'', localidade: p[6]||'', type: 'cp'
      };
      postalEntries[i] = entry;
      postalIndex.set(entry.cp7, entry);
    }
    console.log(`CP7: ${postalEntries.length} entries in ${(performance.now()-t0).toFixed(0)}ms`);
  }

  // ─── Map ──────────────────────────────────────────────
  const map = L.map('map', { center: [39.7, -8.2], zoom: 7, zoomControl: true });

  const tileDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  });
  const tileLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  });

  // Start with dark
  tileDark.addTo(map);

  let currentMarker = null, currentCircle = null;

  function placeMarker(lat, lon, label) {
    if (currentMarker) map.removeLayer(currentMarker);
    if (currentCircle) map.removeLayer(currentCircle);
    currentCircle = L.circle([lat, lon], {
      radius: 80, color: 'var(--accent, #4ade80)', fillColor: 'var(--accent, #4ade80)',
      fillOpacity: 0.1, weight: 1.5, dashArray: '4 4'
    }).addTo(map);
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:12px;height:12px;background:#4ade80;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(74,222,128,0.4)"></div>',
      iconSize: [12,12], iconAnchor: [6,6]
    });
    currentMarker = L.marker([lat, lon], { icon }).addTo(map);
    currentMarker.bindTooltip(label, { permanent: true, direction: 'top', offset: [0,-8], className: 'cp-tooltip' });
    map.flyTo([lat, lon], 15, { duration: 0.8 });
  }

  // ─── Show result card ─────────────────────────────────
  function showResult(item) {
    let lat, lon, name, label = '', distrito = '', concelho = '', localidade = '';

    if (item.type === 'cp') {
      lat = item.lat; lon = item.lon; name = item.cp7;
      label = 'CÓDIGO POSTAL';
      distrito = item.distrito; concelho = item.concelho; localidade = item.localidade;
    } else if (item.type === 'geocoded') {
      lat = item.lat; lon = item.lon; name = item.name;
      label = item.category || 'LOCAL';
      distrito = item.distrito || ''; concelho = item.concelho || ''; localidade = item.localidade || '';
    }

    document.getElementById('resultLabel').textContent = label;
    document.getElementById('resultName').textContent = name;
    document.getElementById('resultCoords').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    document.getElementById('resultDistrito').textContent = distrito || '—';
    document.getElementById('resultConcelho').textContent = concelho || '—';
    document.getElementById('resultLocalidade').textContent = localidade || '—';

    resultCard.classList.remove('hidden');
    placeMarker(lat, lon, item.type === 'cp' ? `${item.cp7} — ${item.name}` : name);
  }

  // ─── Geocoder: Photon + Nominatim ────────────────────
  let geocodeController = null;

  async function geocodeSearch(query) {
    if (geocodeController) geocodeController.abort();
    geocodeController = new AbortController();
    const signal = geocodeController.signal;

    searchStatus.textContent = 'A PESQUISAR...';

    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=pt&lat=39.5&lon=-8.2&location_bias_scale=5`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=pt&limit=6&addressdetails=1`;

    try {
      const [photonRes, nominatimRes] = await Promise.allSettled([
        fetch(photonUrl, { signal }).then(r => r.json()),
        fetch(nominatimUrl, { signal, headers: { 'Accept-Language': 'pt' } }).then(r => r.json())
      ]);

      const results = [];
      const seen = new Set();

      // Parse Photon
      if (photonRes.status === 'fulfilled') {
        for (const f of (photonRes.value.features || [])) {
          const p = f.properties || {};
          const coords = f.geometry?.coordinates;
          if (!coords || (p.country && p.country !== 'Portugal')) continue;
          const name = [p.name, p.street].filter(Boolean).join(', ') || p.locality || p.city || 'Local';
          const detail = [p.hamlet, p.village, p.town, p.city, p.county].filter(Boolean).slice(0, 3).join(', ');
          const key = `${coords[1].toFixed(3)},${coords[0].toFixed(3)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            type: 'geocoded', name, detail,
            lat: coords[1], lon: coords[0],
            category: p.osm_value?.toUpperCase() || p.type?.toUpperCase() || 'LOCAL',
            distrito: p.state || '', concelho: p.county || '', localidade: p.city || p.town || p.village || p.hamlet || ''
          });
        }
      }

      // Parse Nominatim
      if (nominatimRes.status === 'fulfilled') {
        for (const r of (nominatimRes.value || [])) {
          const a = r.address || {};
          const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
          const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const name = a.road || a.hamlet || a.village || a.town || a.city || r.display_name.split(',')[0];
          const detail = [a.hamlet, a.village, a.town, a.city, a.county].filter(Boolean).slice(0, 3).join(', ');
          results.push({
            type: 'geocoded', name, detail,
            lat, lon,
            category: r.type?.toUpperCase() || 'LOCAL',
            distrito: a.state || '', concelho: a.county || '', localidade: a.city || a.town || a.village || a.hamlet || ''
          });
        }
      }

      searchStatus.textContent = results.length > 0 ? `${results.length} RESULTADO${results.length > 1 ? 'S' : ''}` : 'SEM RESULTADOS';
      return results.slice(0, 10);
    } catch (e) {
      if (e.name !== 'AbortError') {
        searchStatus.textContent = 'ERRO DE LIGAÇÃO';
      }
      return [];
    }
  }

  // ─── Main search ──────────────────────────────────────
  let searchTimeout;

  function search(query) {
    ensureParsed();
    const q = query.trim();
    if (q.length < 2) {
      searchResults.innerHTML = '';
      searchStatus.textContent = '';
      return;
    }

    // Check if CP7 or CP4 pattern
    const cpMatch = q.match(/^(\d{4})(?:[-\s]?(\d{0,3}))?$/);
    if (cpMatch) {
      const prefix = cpMatch[2] ? `${cpMatch[1]}-${cpMatch[2]}` : cpMatch[1];
      const results = [];
      for (let i = 0; i < postalEntries.length && results.length < 12; i++) {
        if (postalEntries[i].cp7.startsWith(prefix)) {
          results.push(postalEntries[i]);
        }
      }
      searchStatus.textContent = `${results.length} CP7 ENCONTRADO${results.length !== 1 ? 'S' : ''}`;
      renderResults(results);
      return;
    }

    // Mixed: check if query contains a CP4 + text
    // Extract CP7/CP4 from text like "luis camoes 2540"
    const cpInText = q.match(/\b(\d{4})(?:-(\d{3}))?\b/);
    let cpResults = [];
    if (cpInText && postalEntries) {
      const cpPrefix = cpInText[2] ? `${cpInText[1]}-${cpInText[2]}` : cpInText[1];
      for (let i = 0; i < postalEntries.length && cpResults.length < 3; i++) {
        if (postalEntries[i].cp7.startsWith(cpPrefix)) {
          cpResults.push(postalEntries[i]);
        }
      }
    }

    // Also check if it matches CP name (e.g. "coimbra" matches COIMBRA in postal names)
    const qNorm = normalizeStr(q);
    if (postalEntries && !cpMatch) {
      const nameMatches = [];
      const seenNames = new Set();
      for (let i = 0; i < postalEntries.length && nameMatches.length < 4; i++) {
        const e = postalEntries[i];
        const nameNorm = normalizeStr(e.name);
        if (!seenNames.has(nameNorm) && nameNorm.startsWith(qNorm)) {
          seenNames.add(nameNorm);
          nameMatches.push(e);
        }
      }
      cpResults = [...cpResults, ...nameMatches];
    }

    // Geocode via OSM for the rest
    geocodeSearch(q).then(geoResults => {
      // Merge: CP results first, then geocoded
      const merged = [...cpResults, ...geoResults].slice(0, 12);
      searchStatus.textContent = merged.length > 0 ? `${merged.length} RESULTADO${merged.length > 1 ? 'S' : ''}` : 'SEM RESULTADOS';
      renderResults(merged);
    });
  }

  // ─── Render ───────────────────────────────────────────
  function renderResults(results) {
    searchResults.innerHTML = '';
    results.forEach((item, idx) => {
      const li = document.createElement('li');
      if (item.type === 'cp') {
        li.innerHTML = `
          <span class="result-main">${item.cp7}</span>
          <span class="result-sub">${item.name} · ${item.concelho}</span>
          <span class="result-type">CP7</span>`;
      } else if (item.type === 'geocoded') {
        li.innerHTML = `
          <span class="result-main">${item.name}</span>
          <span class="result-sub">${item.detail || ''}</span>
          <span class="result-type">${item.category}</span>`;
      }
      li.addEventListener('click', () => {
        showResult(item);
        searchResults.innerHTML = '';
        searchInput.value = item.type === 'cp' ? `${item.cp7} — ${item.name}` : item.name;
      });
      if (idx === 0) li.classList.add('active');
      searchResults.appendChild(li);
    });
  }

  // ─── Input handling ───────────────────────────────────
  searchInput.addEventListener('input', () => {
    clearBtn.classList.toggle('visible', searchInput.value.length > 0);
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    // CP7 patterns: instant, no debounce
    if (/^\d{4}[-\s]?\d{0,3}$/.test(q)) {
      search(q);
    } else {
      searchTimeout = setTimeout(() => search(q), 250);
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('li');
    if (!items.length && e.key !== 'Escape') return;
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
      searchStatus.textContent = '';
      searchInput.blur();
    }
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchStatus.textContent = '';
    resultCard.classList.add('hidden');
    clearBtn.classList.remove('visible');
    if (currentMarker) map.removeLayer(currentMarker);
    if (currentCircle) map.removeLayer(currentCircle);
    map.flyTo([39.7, -8.2], 7, { duration: 0.5 });
    searchInput.focus();
  });

  // ─── Copy coordinates ─────────────────────────────────
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

})();
