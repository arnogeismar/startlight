import { useState, type ReactNode } from 'react';

export interface ListItem {
  key: string;
  label: ReactNode;
  search: string;
  group?: string;
}

/** Two-pane layout: searchable list on the left, editor for the selected item on the right. */
export function ListDetail(props: {
  items: ListItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  addLabel?: string;
  onAdd?: () => void;
  empty: ReactNode;
  children: ReactNode;
}) {
  const [q, setQ] = useState('');
  const filtered = props.items.filter((i) => !q || i.search.toLowerCase().includes(q.toLowerCase()));
  let lastGroup: string | undefined;
  return (
    <div className="list-detail">
      <aside className="list-pane">
        {props.onAdd && <button className="btn btn-primary btn-block" onClick={props.onAdd}>{props.addLabel ?? '+ Add'}</button>}
        {props.items.length > 6 && <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <ul>
          {filtered.map((i) => {
            const header = i.group !== undefined && i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            return (
              <li key={i.key}>
                {header && <div className="list-group">{header}</div>}
                <button className={props.selected === i.key ? 'active' : ''} onClick={() => props.onSelect(i.key)}>{i.label}</button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="detail-pane">{props.selected ? props.children : <div className="empty">{props.empty}</div>}</div>
    </div>
  );
}
