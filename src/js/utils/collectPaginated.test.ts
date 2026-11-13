// Tests generated using AI

import collectPaginated from './collectPaginated';

type Item = { id: string };

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

// Builds a fetchPage that returns successive pages from a fixed library and
// records the (start, limit) pairs it was asked for.
const mockPages = (library: Item[], total: number | null, requested: [number, number][] = []) => {
  return vi.fn((start: number, limit: number) => {
    requested.push([start, limit]);
    return Promise.resolve({
      items: library.slice(start, start + limit),
      total,
    });
  });
};

describe('Testing "collectPaginated" utility', () => {
  test('Fetches a single page when it covers the whole total', async () => {
    const requested: [number, number][] = [];
    const fetchPage = mockPages(items('a', 'b'), 2, requested);
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 10, onPage });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(requested).toEqual([[0, 10]]);
    expect(onPage).toHaveBeenCalledWith(items('a', 'b'));
  });

  test('Requests successive pages until the reported total is reached', async () => {
    const requested: [number, number][] = [];
    const fetchPage = mockPages(items('a', 'b', 'c', 'd', 'e'), 5, requested);
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage });

    expect(requested).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
    expect(onPage.mock.calls).toEqual([[items('a', 'b')], [items('c', 'd')], [items('e')]]);
  });

  test('Stops at a short page when the server reports no total', async () => {
    const requested: [number, number][] = [];
    const fetchPage = mockPages(items('a', 'b', 'c'), null, requested);
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage });

    expect(requested).toEqual([
      [0, 2],
      [2, 2],
    ]);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  test('Stops on an empty page', async () => {
    const requested: [number, number][] = [];
    const fetchPage = mockPages([], 0, requested);
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });

  test('Drops duplicate items across pages and stops when a page adds nothing new', async () => {
    // A server that ignores paging keeps returning the same first page.
    const fetchPage = vi.fn(() =>
      Promise.resolve({ items: items('a', 'b'), total: null } satisfies { items: Item[]; total: number | null })
    );
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage });

    // First page is fresh; second page is entirely duplicates, so it stops.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(items('a', 'b'));
  });

  test('Passes only new items to onPage when pages overlap', async () => {
    const pages = [
      { items: items('a', 'b'), total: 5 },
      { items: items('b', 'c'), total: 5 },
      { items: items('d'), total: 5 },
    ];
    const fetchPage = vi.fn(() => Promise.resolve(pages.shift() ?? { items: [], total: 5 }));
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage });

    expect(onPage.mock.calls).toEqual([[items('a', 'b')], [items('c')], [items('d')]]);
  });

  test('Stops without another request when cancelled', async () => {
    let cancelled = false;
    const requested: [number, number][] = [];
    const fetchPage = mockPages(items('a', 'b', 'c', 'd'), 4, requested);
    const onPage = vi.fn(() => {
      cancelled = true;
    });

    await collectPaginated({
      fetchPage,
      getId: (i) => i.id,
      pageSize: 2,
      onPage,
      isCancelled: () => cancelled,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  test('Never exceeds maxPages', async () => {
    // Infinite library that always returns a full page and no total.
    const fetchPage = vi.fn((start: number) =>
      Promise.resolve({ items: items(`a${start}`, `b${start}`), total: null })
    );
    const onPage = vi.fn();

    await collectPaginated({ fetchPage, getId: (i) => i.id, pageSize: 2, onPage, maxPages: 3 });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(onPage).toHaveBeenCalledTimes(3);
  });
});
