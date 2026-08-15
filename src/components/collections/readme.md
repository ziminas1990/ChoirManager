# Collections

`IPlainCollection` is an interface for a collection of plain structures, that is, structures without nested types.

Adapter-backed collections are implementations of this interface that use a specific storage backend, such as Google Sheets, MongoDB, or Firestore.
Directly using an adapter-backed collection may be a bad idea, since accessing a remote database can be slow and expensive.

Caching collections wrap adapter-backed collections and add a caching strategy on top of them.

**CacheAsideCollection** stores a simple cache of previously fetched values.
The `get` operation checks the local cache first and, in case of a cache miss, falls back to the underlying adapter-backed collection.
The `find` operation always falls back to the underlying collection.
This approach is suitable only when the collection is read-only or when `CacheAsideCollection` is the only owner that can modify the underlying data. Otherwise, the cache may become stale if the collection is modified elsewhere.
