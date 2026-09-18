import { addProductAction } from '@/lib/actions';

// Manual add (portal + admin): lands as a candidate, deduped against the
// whole catalog by url_key/name_key (createProductManual's matchExisting),
// so adding a product discovery already found routes to the existing row.
// No array fields here, so a plain <form action> with no client JS suffices
// (the AddCompanyForm precedent).
export default function AddProductForm({ categories }: { categories: { slug: string; name: string }[] }) {
  return (
    <form
      action={addProductAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', maxWidth: 560 }}
    >
      <div className="field">
        <label htmlFor="ap-name">Product name</label>
        <input id="ap-name" name="name" className="input" required minLength={2} maxLength={200} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="ap-vendor">Vendor (optional)</label>
          <input id="ap-vendor" name="vendor" className="input" maxLength={200} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="ap-category">Category</label>
          <select id="ap-category" name="category" className="input" required defaultValue={categories[0]?.slug}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ap-url">Homepage URL (optional, drives dedupe)</label>
        <input id="ap-url" name="url" className="input" type="url" placeholder="https://" />
      </div>
      <div className="field">
        <label htmlFor="ap-oneliner">One-liner (optional)</label>
        <input id="ap-oneliner" name="one_liner" className="input" maxLength={300} />
      </div>
      <div>
        <button type="submit" className="btn btn--primary btn--sm">Add the product</button>
      </div>
    </form>
  );
}
