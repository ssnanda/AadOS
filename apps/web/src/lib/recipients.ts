// Recipient addresses of a stored email (its To line), shared by the server rows and the web lists.
// Pure, no imports, so `node --test` can load it.

/** Lower-cased, de-duplicated addresses from a To line ("Kohls <KOHLS@x.com>, b@y.com" → ["kohls@x.com", "b@y.com"]). */
export const recipients = (to: string | undefined): string[] => [...new Set((to || '').match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/gi)?.map((a) => a.toLowerCase()) ?? [])];

/** Short label for a list row: the first address, plus how many more. */
export const recipientLabel = (list: string[]) => (list.length ? `${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ''}` : '');
