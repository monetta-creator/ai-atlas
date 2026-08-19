import type { ReactNode } from 'react';
import Editable from './Editable';

// Shared long-form section renderer for the About pages. Each section has a stable
// `id` (used as the React key and the content-override key, since the heading text
// itself can be edited). When `editing` + `keyPrefix` + `txt` are passed, the heading
// and string bodies become inline-editable; rich JSX bodies always render as-is.
export type ProseSection = { id: string; heading: string; body: ReactNode };

type Props = {
  sections: ProseSection[];
  editing?: boolean;
  keyPrefix?: string;
  txt?: (key: string, fallback: string) => string;
};

export default function Prose({ sections, editing = false, keyPrefix, txt }: Props) {
  const canKey = !!keyPrefix;
  const live = !!(editing && keyPrefix && txt);
  return (
    <div className="about-prose">
      {sections.map((s) => {
        const hKey = canKey ? `${keyPrefix}.sec.${s.id}.heading` : '';
        const bKey = canKey ? `${keyPrefix}.sec.${s.id}.body` : '';
        const headingText = canKey && txt ? txt(hKey, s.heading) : s.heading;
        const isString = typeof s.body === 'string';
        const bodyText = isString
          ? canKey && txt
            ? txt(bKey, s.body as string)
            : (s.body as string)
          : null;
        return (
          <section key={s.id}>
            {live ? (
              <Editable as="h2" k={hKey} value={headingText} editing multiline={false} />
            ) : (
              <h2>{headingText}</h2>
            )}
            {isString ? (
              live ? (
                <Editable as="p" k={bKey} value={bodyText as string} editing multiline />
              ) : (
                <p>{bodyText}</p>
              )
            ) : (
              s.body
            )}
          </section>
        );
      })}
    </div>
  );
}
