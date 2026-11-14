import type { AnnotationControls, Tool } from "./useAnnotations";
import { annotationLabels, type Annotation } from "../core/annotations/model";
import { MenuHeading, ToolButton } from "./CompactMenu";
import { useState } from "react";
export const toolNames: Record<Tool, string> = {
  select: "Auswählen / Verschieben",
  Ink: "Freihand",
  Text: "Notiz",
  FreeText: "Textfeld",
  erase: "Ink-Teilradierer (Klick)",
};
export function DirectTools({
  editor: e,
  ready,
}: {
  editor: AnnotationControls;
  ready: boolean;
}) {
  const blocked = !ready || e.busy || e.formDirty || !!e.state.readOnly;
  const choose = (tool: Tool) => {
    e.gesture.cancel();
    e.closeContext();
    document
      .querySelectorAll<HTMLElement>(".compact-menu:popover-open")
      .forEach((menu) => menu.hidePopover());
    e.setTool(tool);
  };
  return (
    <div
      className="direct-tools"
      role="toolbar"
      aria-label="Annotationswerkzeuge"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <ToolButton
        icon="select"
        label={toolNames.select}
        pressed={e.tool === "select"}
        disabled={blocked}
        onClick={() => choose("select")}
      />
      <ToolButton
        icon="pen"
        label={toolNames.Ink}
        pressed={e.tool === "Ink"}
        disabled={blocked}
        onClick={() => choose("Ink")}
      />
      <ToolButton
        icon="note"
        label={toolNames.Text}
        pressed={e.tool === "Text"}
        disabled={blocked}
        onClick={() => choose("Text")}
      />
      <ToolButton
        icon="text"
        label={toolNames.FreeText}
        pressed={e.tool === "FreeText"}
        disabled={blocked}
        onClick={() => choose("FreeText")}
      />
      <ToolButton
        icon="image"
        label="Bild einfügen …"
        disabled={blocked}
        onClick={e.chooseImage}
      />
      <ToolButton
        icon="eraser"
        label={toolNames.erase}
        pressed={e.tool === "erase"}
        disabled={blocked}
        onClick={() => choose("erase")}
      />
      <ToolButton
        icon="settings"
        label="Werkzeugeigenschaften"
        disabled={blocked || e.tool === "select"}
        popoverTarget="tools-menu"
        onClick={e.closeContext}
      />
    </div>
  );
}
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
      id="tools-menu"
      popover="auto"
      className="compact-menu annotation-toolbar"
      aria-label="Werkzeugeigenschaften"
    >
      <MenuHeading target="tools-menu">
        {toolNames[e.tool]} · Eigenschaften
      </MenuHeading>
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
          (e.tool === "select"
            ? "Auf freier Fläche eine Box ziehen. Berührte Markierungen gemeinsam verschieben. Mit zwei Fingern die Ansicht bewegen."
            : "Werkzeug einstellen, Menü schließen und auf der PDF arbeiten.")}
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
          {item.type !== "Stamp" && (
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
          )}
          {item.type === "Stamp" && (
            <p className="small">
              Bild über die Eckgriffe proportional skalieren. „Inhalt“ dient als
              Kommentar zum Bild.
            </p>
          )}
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
      {e.selection.length > 1 && (
        <div className="selection-summary">
          <strong>{e.selection.length} Markierungen ausgewählt</strong>
          <p className="small">
            An einer ausgewählten Markierung ziehen, um alle gemeinsam zu
            verschieben.
          </p>
          <button disabled={e.busy} onClick={() => e.setSelected(null)}>
            Auswahl aufheben
          </button>
        </div>
      )}
      <div className="annotation-list">
        {e.items.length === 0 ? (
          <p>Keine Annotationen auf dieser Seite.</p>
        ) : (
          e.items.map((a) => (
            <button
              key={a.id}
              disabled={e.busy || e.formDirty}
              aria-pressed={e.selection.includes(a.id)}
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
