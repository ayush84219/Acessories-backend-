/**
 * Ultra-Lightweight & High-Performance In-Memory DSA Search & Indexing Engine
 * Memory-Optimized for Cloud Containers (512MB RAM cap)
 * 
 * Implements:
 * 1. Lean Inverted Index: O(1) keyword and attribute lookup with compact arrays/sets
 * 2. Lightweight Trie (Prefix Tree): O(m) auto-suggest without intermediate ID bloat
 * 3. Fast In-Memory Multi-Field Sort & Slicing: O(n log n)
 * 4. Memory-safe item projections (stripping large unused DB columns)
 */

// ── 1. LIGHTWEIGHT TRIE (Auto-Suggest & Word Prefix Matching) ───────────────────
class CompactTrieNode {
  constructor() {
    this.c = Object.create(null); // Compact char map (no Map overhead)
    this.isEnd = false;
    this.freq = 0;
  }
}

export class Trie {
  constructor() {
    this.root = new CompactTrieNode();
    this.totalWords = 0;
  }

  insert(word) {
    if (!word || typeof word !== 'string') return;
    const cleanWord = word.trim().toLowerCase();
    if (cleanWord.length < 2 || cleanWord.length > 30) return;

    let current = this.root;
    for (let i = 0; i < cleanWord.length; i++) {
      const char = cleanWord[i];
      if (!current.c[char]) {
        current.c[char] = new CompactTrieNode();
      }
      current = current.c[char];
    }
    if (!current.isEnd) {
      current.isEnd = true;
      this.totalWords += 1;
    }
    current.freq += 1;
  }

  // Returns array of auto-complete suggestions matching prefix (O(m + k))
  autoComplete(prefix, maxResults = 8) {
    if (!prefix || typeof prefix !== 'string') return [];
    const cleanPrefix = prefix.trim().toLowerCase();
    let current = this.root;

    for (let i = 0; i < cleanPrefix.length; i++) {
      const char = cleanPrefix[i];
      if (!current.c[char]) return [];
      current = current.c[char];
    }

    const suggestions = [];
    this._dfsCollect(current, cleanPrefix, suggestions, maxResults);
    return suggestions;
  }

  // Collect words matching a prefix (used by search engine for prefix queries)
  getWordsWithPrefix(prefix, maxWords = 40) {
    if (!prefix || typeof prefix !== 'string') return [];
    const cleanPrefix = prefix.trim().toLowerCase();
    let current = this.root;

    for (let i = 0; i < cleanPrefix.length; i++) {
      const char = cleanPrefix[i];
      if (!current.c[char]) return [];
      current = current.c[char];
    }

    const words = [];
    this._dfsCollectWords(current, cleanPrefix, words, maxWords);
    return words;
  }

  _dfsCollect(node, currentPrefix, suggestions, maxResults) {
    if (suggestions.length >= maxResults) return;
    if (node.isEnd) {
      suggestions.push({
        text: currentPrefix,
        freq: node.freq
      });
    }

    const keys = Object.keys(node.c);
    for (let i = 0; i < keys.length; i++) {
      if (suggestions.length >= maxResults) break;
      this._dfsCollect(node.c[keys[i]], currentPrefix + keys[i], suggestions, maxResults);
    }
  }

  _dfsCollectWords(node, currentPrefix, words, maxWords) {
    if (words.length >= maxWords) return;
    if (node.isEnd) {
      words.push(currentPrefix);
    }
    const keys = Object.keys(node.c);
    for (let i = 0; i < keys.length; i++) {
      if (words.length >= maxWords) break;
      this._dfsCollectWords(node.c[keys[i]], currentPrefix + keys[i], words, maxWords);
    }
  }

  clear() {
    this.root = new CompactTrieNode();
    this.totalWords = 0;
  }
}

// ── 2. BINARY SEARCH INDEX (Range Queries O(log n)) ───────────────────────────
export class BinarySearchIndex {
  static binarySearchLowerBound(arr, key, value) {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (Number(arr[mid][key] || 0) >= value) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  static binarySearchUpperBound(arr, key, value) {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (Number(arr[mid][key] || 0) > value) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  static rangeSearch(sortedArr, key, minVal, maxVal) {
    const startIdx = this.binarySearchLowerBound(sortedArr, key, minVal);
    const endIdx = this.binarySearchUpperBound(sortedArr, key, maxVal);
    return sortedArr.slice(startIdx, endIdx);
  }
}

// ── 3. HIGH-EFFICIENCY IN-MEMORY DSA SEARCH ENGINE ────────────────────────────
export class DSASearchEngine {
  constructor() {
    this.itemsMap = new Map(); // id -> lean item object
    this.invertedIndex = new Map(); // token -> Array of item IDs (compact O(1) lookup)
    this.categoryIndex = new Map(); // categoryKey -> Array of item IDs
    this.locationIndex = new Map(); // locationKey -> Array of item IDs
    this.trie = new Trie(); // Prefix autocomplete tree
    this.lastIndexedAt = null;
    this.isReady = false;
  }

  // Tokenizes strings into clean searchable words
  _tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_/]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  // Sanitizes and projects only essential fields to minimize memory usage
  _toLeanItem(item) {
    if (!item || !item.id) return null;
    return {
      id: String(item.id),
      name: item.name ? String(item.name).slice(0, 150) : '',
      category: item.category ? String(item.category).slice(0, 50) : '',
      brand: item.brand ? String(item.brand).slice(0, 50) : '',
      style: item.style ? String(item.style).slice(0, 80) : '',
      color: item.color ? String(item.color).slice(0, 50) : '',
      lotNo: item.lotNo ? String(item.lotNo).slice(0, 40) : (item.Lot_Number ? String(item.Lot_Number) : ''),
      lotNo2: item.lotNo2 ? String(item.lotNo2).slice(0, 40) : '',
      stock: Number(item.stock || item.quantity || item.Cutting_Qty || 0),
      cost: Number(item.cost || item.totalCost || item.price || 0),
      location: item.location ? String(item.location).slice(0, 50) : '',
      supplier: item.supplier ? String(item.supplier).slice(0, 80) : '',
      poNumber: item.poNumber ? String(item.poNumber).slice(0, 50) : '',
      unit: item.unit ? String(item.unit).slice(0, 20) : '',
      itemType: item.itemType || 'material',
      imageUrl: item.imageUrl ? String(item.imageUrl).slice(0, 250) : ''
    };
  }

  // Build or Re-index complete dataset
  buildIndex(items = []) {
    const startTime = performance.now();
    this.itemsMap.clear();
    this.invertedIndex.clear();
    this.categoryIndex.clear();
    this.locationIndex.clear();
    this.trie.clear();

    const tempInverted = new Map();
    const tempCat = new Map();
    const tempLoc = new Map();

    for (let idx = 0; idx < items.length; idx++) {
      const rawItem = items[idx];
      const lean = this._toLeanItem(rawItem);
      if (!lean) continue;

      const id = lean.id;
      this.itemsMap.set(id, lean);

      // Index tokens from primary searchable fields
      const searchableText = `${lean.name} ${lean.id} ${lean.category} ${lean.brand} ${lean.style} ${lean.color} ${lean.lotNo} ${lean.poNumber} ${lean.supplier} ${lean.location}`;
      const words = this._tokenize(searchableText);
      const uniqueWords = new Set(words);

      for (const w of uniqueWords) {
        let list = tempInverted.get(w);
        if (!list) {
          list = [];
          tempInverted.set(w, list);
          this.trie.insert(w);
        }
        list.push(id);
      }

      // Index category
      if (lean.category) {
        const catKey = lean.category.toLowerCase().trim();
        let catList = tempCat.get(catKey);
        if (!catList) {
          catList = [];
          tempCat.set(catKey, catList);
        }
        catList.push(id);
      }

      // Index location
      if (lean.location) {
        const locKey = lean.location.toLowerCase().trim();
        let locList = tempLoc.get(locKey);
        if (!locList) {
          locList = [];
          tempLoc.set(locKey, locList);
        }
        locList.push(id);
      }
    }

    // Assign indexed maps
    this.invertedIndex = tempInverted;
    this.categoryIndex = tempCat;
    this.locationIndex = tempLoc;

    this.lastIndexedAt = new Date().toISOString();
    this.isReady = true;
    const elapsedMs = (performance.now() - startTime).toFixed(2);
    console.log(`[DSA Engine] Indexed ${this.itemsMap.size} items in ${elapsedMs}ms. Tokens: ${this.invertedIndex.size}, Trie words: ${this.trie.totalWords}`);
  }

  // Incremental O(1) Upsert
  upsert(item) {
    const lean = this._toLeanItem(item);
    if (!lean) return;
    const id = lean.id;
    this.itemsMap.set(id, lean);

    const tokens = this._tokenize(`${lean.name} ${lean.category} ${lean.location} ${lean.color} ${lean.poNumber} ${lean.brand} ${lean.style} ${lean.lotNo}`);
    const uniqueTokens = new Set(tokens);

    for (const token of uniqueTokens) {
      let list = this.invertedIndex.get(token);
      if (!list) {
        list = [];
        this.invertedIndex.set(token, list);
        this.trie.insert(token);
      }
      if (!list.includes(id)) list.push(id);
    }

    if (lean.category) {
      const catKey = lean.category.toLowerCase().trim();
      let catList = this.categoryIndex.get(catKey);
      if (!catList) {
        catList = [];
        this.categoryIndex.set(catKey, catList);
      }
      if (!catList.includes(id)) catList.push(id);
    }
  }

  // Incremental O(1) Remove
  remove(id) {
    const strId = String(id);
    this.itemsMap.delete(strId);
  }

  // ── 4. HIGH-PERFORMANCE SEARCH WITH DSA PIPELINE ────────────────────────────
  /**
   * Fast multi-attribute query search
   * Complexity: O(1) Hash Map token lookup + O(m) Trie Prefix expansion
   */
  search({
    query = '',
    category = '',
    location = '',
    minStock = null,
    maxStock = null,
    minCost = null,
    maxCost = null,
    sortBy = 'name', // 'name', 'stock', 'cost', 'id'
    sortOrder = 'asc', // 'asc', 'desc'
    page = 1,
    limit = 50
  } = {}) {
    const startTime = performance.now();
    let candidateIds = null;

    // 1. Prefix and Keyword Search via Trie + Inverted Index
    const searchTokens = this._tokenize(query);
    if (searchTokens.length > 0) {
      for (const token of searchTokens) {
        // Find matching IDs from exact token
        const exactList = this.invertedIndex.get(token) || [];
        const tokenMatches = new Set(exactList);

        // Find matching IDs from prefix expansions via Trie
        const prefixWords = this.trie.getWordsWithPrefix(token, 25);
        for (let i = 0; i < prefixWords.length; i++) {
          const matchedToken = prefixWords[i];
          if (matchedToken !== token) {
            const list = this.invertedIndex.get(matchedToken);
            if (list) {
              for (let j = 0; j < list.length; j++) {
                tokenMatches.add(list[j]);
              }
            }
          }
        }

        if (candidateIds === null) {
          candidateIds = tokenMatches;
        } else {
          // Set Intersection (AND semantics) for multi-token precision
          const intersected = new Set();
          for (const id of candidateIds) {
            if (tokenMatches.has(id)) intersected.add(id);
          }
          candidateIds = intersected;
        }

        if (candidateIds.size === 0) break;
      }
    }

    // 2. Category Filter via Hash Index O(1)
    if (category) {
      const catKey = String(category).toLowerCase().trim();
      const catList = this.categoryIndex.get(catKey) || [];
      const catSet = new Set(catList);

      if (candidateIds === null) {
        candidateIds = catSet;
      } else {
        const intersected = new Set();
        for (const id of candidateIds) {
          if (catSet.has(id)) intersected.add(id);
        }
        candidateIds = intersected;
      }
    }

    // 3. Location Filter via Hash Index O(1)
    if (location) {
      const locKey = String(location).toLowerCase().trim();
      const locList = this.locationIndex.get(locKey) || [];
      const locSet = new Set(locList);

      if (candidateIds === null) {
        candidateIds = locSet;
      } else {
        const intersected = new Set();
        for (const id of candidateIds) {
          if (locSet.has(id)) intersected.add(id);
        }
        candidateIds = intersected;
      }
    }

    // 4. Resolve full items
    let results = [];
    if (candidateIds === null) {
      results = Array.from(this.itemsMap.values());
    } else {
      for (const id of candidateIds) {
        const item = this.itemsMap.get(id);
        if (item) results.push(item);
      }
    }

    // 5. In-Memory Range Filters
    if (minStock !== null || maxStock !== null) {
      const min = minStock !== null ? Number(minStock) : -Infinity;
      const max = maxStock !== null ? Number(maxStock) : Infinity;
      results = results.filter(item => {
        const s = Number(item.stock || 0);
        return s >= min && s <= max;
      });
    }

    if (minCost !== null || maxCost !== null) {
      const min = minCost !== null ? Number(minCost) : -Infinity;
      const max = maxCost !== null ? Number(maxCost) : Infinity;
      results = results.filter(item => {
        const c = Number(item.cost || 0);
        return c >= min && c <= max;
      });
    }

    // 6. Fast Sorting (O(n log n))
    const isAsc = String(sortOrder).toLowerCase() === 'asc';
    results.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'number' && typeof valB === 'number') {
        return isAsc ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return isAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });

    // 7. Pagination (O(k) Slicing)
    const totalCount = results.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(1000, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const paginatedItems = results.slice(offset, offset + limitNum);

    const searchTimeMs = (performance.now() - startTime).toFixed(3);

    return {
      items: paginatedItems,
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum),
      searchTimeMs: Number(searchTimeMs),
      dsaMetrics: {
        algorithm: 'O(1) Hash Map Inverted Index + O(m) Trie Prefix + O(n log n) Sort',
        timeComplexity: query ? 'O(1) ~ O(m)' : 'O(n log n)',
        spaceComplexity: 'O(N) Compact',
        totalIndexedItems: this.itemsMap.size,
        tokensCount: this.invertedIndex.size,
        trieWordsCount: this.trie.totalWords,
        executionTime: `${searchTimeMs}ms`
      }
    };
  }

  // ── 5. AUTO-SUGGEST API (Trie Prefix Engine O(m)) ───────────────────────────
  suggest(prefix, max = 8) {
    const startTime = performance.now();
    const suggestions = this.trie.autoComplete(prefix, max);
    const timeMs = (performance.now() - startTime).toFixed(3);
    return {
      prefix,
      suggestions,
      executionTime: `${timeMs}ms`,
      complexity: 'O(m) Trie Prefix Search'
    };
  }

  // Stats
  getStats() {
    return {
      totalItems: this.itemsMap.size,
      totalTokens: this.invertedIndex.size,
      totalCategories: this.categoryIndex.size,
      totalLocations: this.locationIndex.size,
      trieWords: this.trie.totalWords,
      lastIndexedAt: this.lastIndexedAt,
      isReady: this.isReady
    };
  }
}

// Singleton instance
export const dsaEngine = new DSASearchEngine();

