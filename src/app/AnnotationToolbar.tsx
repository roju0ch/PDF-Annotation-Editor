import type { AnnotationControls, Tool } from "./useAnnotations";
import { annotationLabels, type Annotation } from "../core/annotations/model";
import { MenuHeading, handleMenuKeyDown } from "./CompactMenu";
import { useState } from "react";
export function AnnotationToolbar({
  editor: e,
  ready,
}: {
  editor: AnnotationControls;
  ready: boolean;
}) {
  const blocked = !ready || e.busy || !!e.state.readOnly;
  return (
    <section
      onKeyDown={handleMenuKeyDown}
      id="tools-menu"
      popover="auto"
      className="compact-menu annotation-toolbar"
      aria-label="Annotationswerkzeuge"
    >
      <MenuHeading target="tools-menu">Werkzeuge</MenuHeading>
      <label>
        Werkzeug{" "}
        <select
          aria-label="Werkzeug"
          disabled={blocked || e.formDirty}
          value={e.tool}
          onChange={(ev) => e.setTool(ev.target.value as Tool)}
        >
          <option value="select">Auswählen / Verschieben</option>
          <option value="Ink">Freihand</option>
          <option value="Text">Notiz</option>
          <option value="FreeText">Textfeld</option>
          <option value="erase">Ink-Teilradierer (Klick)</option>
        </select>
      </label>
      {e.tool !== "select" && e.tool !== "erase" && (
        <label>
          Farbe{" "}
          <input
            type="color"
            aria-label="Zeichenfarbe"
            value={e.color}
            disabled={blocked}
            onChange={(ev) => e.setColor(ev.target.value)}
          />
        </label>
      )}
      {e.tool === "Ink" && (
        <label>
          Strich{" "}
          <input
            type="number"
            aria-label="Strichbreite"
            min="0.1"
            max="30"
            step="0.5"
            value={e.width}
            disabled={blocked}
            onChange={(ev) => e.setWidth(Number(ev.target.value))}
          />{" "}
          pt
        </label>
      )}
      {(e.tool === "Text" || e.tool === "FreeText") && (
        <label>
          Text{" "}
          <input
            aria-label="Neuer Annotationstext"
            maxLength={10000}
            value={e.text}
            disabled={blocked}
            onChange={(ev) => e.setText(ev.target.value)}
          />
        </label>
      )}
      {e.tool === "FreeText" && (
        <label>
          Schrift{" "}
          <input
            type="number"
            aria-label="Neue Schriftgröße"
            min="6"
            max="96"
            value={e.fontSize}
            disabled={blocked}
            onChange={(ev) => e.setFontSize(Number(ev.target.value))}
          />{" "}
          pt
        </label>
      )}
      {e.tool === "erase" && (
        <label>
          Radius{" "}
          <input
            type="number"
            aria-label="Radierer-Radius"
            min="0.1"
            max="500"
            value={e.radius}
            disabled={blocked}
            onChange={(ev) => e.setRadius(Number(ev.target.value))}
          />{" "}
          pt
        </label>
      )}
      <span className="edit-status">
        {e.state.readOnly ||
          "Werkzeug einstellen, Menü schließen und auf der PDF arbeiten."}
      </span>
    </section>
  );
}
function Properties({ item, e }: { item: Annotation; e: AnnotationControls }) {
  const [contents, setContents] = useState(item.contents),
    [color, setColor] = useState(item.color),
    [width, setWidth] = useState(item.width),
    [fontSize, setFontSize] = useState(item.fontSize);
  return (
    <form
      className="properties"
      onSubmit={(ev) => {
        ev.preventDefault();
        const patch = {
          ...(contents !== item.contents ? { contents } : {}),
          ...(color !== item.color ? { color } : {}),
          ...(item.type === "Ink" && width !== item.width ? { width } : {}),
          ...(item.type === "FreeText" && fontSize !== item.fontSize
            ? { fontSize }
            : {}),
        };
        void e.edit({ action: "update", page: item.page, id: item.id, patch });
      }}
    >
      <strong>{annotationLabels[item.type] ?? item.type}</strong>
      {!item.editable && (
        <p>Dieses Objekt bleibt erhalten und ist nicht bearbeitbar.</p>
      )}
      <label>
        Inhalt
        <textarea
          aria-label="Annotationsinhalt"
          disabled={!item.editable || e.busy}
          maxLength={10000}
          value={contents}
          onChange={(ev) => {
            setContents(ev.target.value);
            e.setFormDirty(true);
          }}
        />
      </label>
      {item.editable && (
        <>
          <label>
            Farbe
            <input
              type="color"
              aria-label="Annotationsfarbe"
              disabled={e.busy}
              value={color}
              onChange={(ev) => {
                setColor(ev.target.value);
                e.setFormDirty(true);
              }}
            />
          </label>
          {item.type === "Ink" && (
            <label>
              Strichbreite
              <input
                type="number"
                aria-label="Annotationsstrichbreite"
                disabled={e.busy}
                min=".1"
                max="30"
                step=".5"
                value={width}
                onChange={(ev) => {
                  setWidth(Number(ev.target.value));
                  e.setFormDirty(true);
                }}
              />
            </label>
          )}
          {item.type === "FreeText" && (
            <label>
              Schriftgröße
              <input
                type="number"
                aria-label="Annotationsschriftgröße"
                disabled={e.busy}
                min="6"
                max="96"
                value={fontSize}
                onChange={(ev) => {
                  setFontSize(Number(ev.target.value));
                  e.setFormDirty(true);
                }}
              />
            </label>
          )}
          <div>
            <button type="submit" disabled={e.busy || !e.formDirty}>
              Übernehmen
            </button>
            <button
              type="button"
              disabled={e.busy || !e.formDirty}
              onClick={() => {
                setContents(item.contents);
                setColor(item.color);
                setWidth(item.width);
                setFontSize(item.fontSize);
                e.setFormDirty(false);
              }}
            >
              Verwerfen
            </button>
          </div>
          <button
            type="button"
            disabled={e.busy || e.formDirty}
            onClick={() =>
              void e.edit({ action: "delete", page: item.page, id: item.id })
            }
          >
            Annotation löschen
          </button>
        </>
      )}
    </form>
  );
}
export function AnnotationPanel({
  editor: e,
  page,
}: {
  editor: AnnotationControls;
  page: number;
}) {
  const selected = e.items.find((a) => a.id === e.selected);
  return (
    <aside
      onKeyDown={handleMenuKeyDown}
      id="annotations-menu"
      popover="auto"
      className="compact-menu annotation-panel"
      aria-label="Annotationen"
    >
      <MenuHeading target="annotations-menu">
        Annotationen · Seite {page + 1}
      </MenuHeading>
      <p className="small">
        Änderungen als PDF herunterladen. Keine automatische Wiederherstellung.
      </p>
      <div className="annotation-list">
        {e.items.length === 0 ? (
          <p>Keine Annotationen auf dieser Seite.</p>
        ) : (
          e.items.map((a) => (
            <button
              key={a.id}
              disabled={e.busy || e.formDirty}
              aria-pressed={a.id === e.selected}
              onClick={() => {
                e.setSelected(a.id);
                e.setTool("select");
              }}
            >
              {annotationLabels[a.type] ?? a.type}
              {a.editable ? "" : " · geschützt"}
              <span>{a.contents || "Ohne Text"}</span>
            </button>
          ))
        )}
      </div>
      {selected && (
        <Properties key={JSON.stringify(selected)} item={selected} e={e} />
      )}
      {e.notice && <p>{e.notice}</p>}
    </aside>
  );
}
