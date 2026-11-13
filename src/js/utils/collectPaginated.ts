// A single page returned by a paginated API call.
type Page<T> = {
  items: T[];
  // Total number of items on the server, or null when it isn't reported.
  total: number | null;
};

type CollectPaginatedOptions<T> = {
  // Fetches one page starting at `start`, asking for `limit` items.
  fetchPage: (start: number, limit: number) => Promise<Page<T>>;
  // Stable identity for an item, used to drop duplicates between pages.
  getId: (item: T) => string;
  // Number of items to request per page.
  pageSize: number;
  // Called with each page's new (de-duplicated) items as it arrives.
  onPage: (items: T[]) => void;
  // Return true to stop before the next request, e.g. when the caller has been superseded.
  isCancelled?: () => boolean;
  // Safety cap on requests, in case a server ignores paging entirely.
  maxPages?: number;
};

/** Fetches every page of a paginated endpoint in order, passing each page's new items to
 * `onPage` as they arrive. Stops once the reported total is reached, a short or empty page
 * arrives, or a page adds no new items (so a server that ignores paging can't loop forever). */
const collectPaginated = async <T>({
  fetchPage,
  getId,
  pageSize,
  onPage,
  isCancelled,
  maxPages = 10000,
}: CollectPaginatedOptions<T>): Promise<void> => {
  const seen = new Set<string>();
  let start = 0;

  for (let page = 0; page < maxPages; page++) {
    if (isCancelled?.()) return;

    const { items, total } = await fetchPage(start, pageSize);

    if (isCancelled?.()) return;

    const fresh = items.filter((item) => {
      const id = getId(item);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (fresh.length > 0) onPage(fresh);

    start += items.length;

    // Nothing left to read.
    if (items.length === 0) return;
    // Reached the server-reported total.
    if (total !== null && total !== undefined && start >= total) return;
    // No total reported, so assume a short page is the last one.
    if ((total === null || total === undefined) && items.length < pageSize) return;
    // The server returned only duplicates, so it is ignoring paging.
    if (fresh.length === 0) return;
  }
};

export default collectPaginated;
