// Preserve the exact system text; only the stable prefix receives a cache marker.
// Tool definitions precede system blocks in Claude's cache, so changing tools
// naturally invalidates this prefix as well. No passenger history is marked.
export function cachedSystem({ system, cachePrefix, promptCaching = false }) {
 if (!promptCaching || typeof system !== 'string' || typeof cachePrefix !== 'string'
  || !cachePrefix || !system.startsWith(cachePrefix)) return system;
 const blocks = [{ type: 'text', text: cachePrefix, cache_control: { type: 'ephemeral', ttl: '5m' } }];
 const dynamic = system.slice(cachePrefix.length);
 if (dynamic) blocks.push({ type: 'text', text: dynamic });
 return blocks;
}
