'use client';

import {
  SELECT_CONTENT,
  SELECT_ITEM,
  SELECT_TRIGGER,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/context';
import { IFC_SCHEMAS } from '@/lib/ifc/writer';
import { DEFAULT_SITE_NAME, type IfcMeta, type IfcSchema, newIfcMeta } from '@/lib/types';

export type IfcFlyoutProps = {
  ifc: IfcMeta;
  /** What IfcProject.Name will say with the field blank — the site's own
   *  coordinates. Passed in rather than derived: only the caller has the meta. */
  defaultProjectName: string;
  onChange: (patch: Partial<IfcMeta>) => void;
  onReset: () => void;
  onClose: () => void;
};

/** One text attribute. Every field on this panel is the same shape, and there
 *  are nine of them — written out by hand that is nine copies of a label, an
 *  input and an id that has to match it. */
function Attr(p: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label className="eyebrow block mb-1.5" htmlFor={p.id}>
        {p.label}
      </label>
      <input
        id={p.id}
        type="text"
        className="ctl-input w-full"
        value={p.value}
        placeholder={p.placeholder}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </div>
  );
}

/** Whether the bag is still what a fresh session starts with — the whole test
 *  for whether Reset has anything to do. */
const isDefaultIfc = (a: IfcMeta): boolean => {
  const d = newIfcMeta();
  return (Object.keys(d) as (keyof IfcMeta)[]).every((k) => a[k] === d[k]);
};

/**
 * What the exported file says about itself, off the wrench beside Download.
 *
 * It hangs there rather than off the rail because these are properties of the
 * deliverable, not of the build: the schema decides how the scene is written and
 * the rest are names on the two roots it is written into, and none of them
 * re-fetches anything. That is also why it opens upward from a button in the
 * status bar instead of sideways from the rail — the thing it belongs to is the
 * export, and the export is down here.
 *
 * Blank is the resting state of every text field, and blank means the attribute
 * is left out of the file. The two that have a fallback instead of being omitted
 * show it as a placeholder, so an untouched panel still reads as a promise about
 * what you are going to get.
 */
export function IfcFlyout(p: IfcFlyoutProps) {
  const { t } = useT();
  const a = p.ifc;

  /* The trigger shows the label of the selected option rather than the bare
     value ("IFC4") only if the root is handed the whole map, so the list and the
     trigger both read their text from this. */
  const schemaItems: Record<IfcSchema, string> = {
    IFC2X3: t('ifc.schema2x3'),
    IFC4: t('ifc.schema4'),
    IFC4X3: t('ifc.schema4x3'),
  };

  return (
    <div className="flyout floating ifcFlyout" id="ifcFlyout" aria-label={t('ifc.title')}>
      <div className="dockHead">
        <span className="eyebrow">{t('ifc.title')}</span>
        <button
          type="button"
          className="iconBtn"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={p.onClose}
        >
          ✕
        </button>
      </div>

      <div className="fieldHint mb-4">{t('ifc.lead')}</div>

      <div className="field">
        <label className="eyebrow flex items-center gap-1.5 mb-1.5" htmlFor="ifcSchema">
          <img className="ifcLogo" src="/IFC_logo.png" alt="" aria-hidden="true" />
          {t('ifc.schema')}
        </label>
        <Select
          items={schemaItems}
          value={a.schema}
          onValueChange={(v) => p.onChange({ schema: v as IfcSchema })}
        >
          <SelectTrigger id="ifcSchema" className={SELECT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            {IFC_SCHEMAS.map((v) => (
              <SelectItem key={v} value={v} className={SELECT_ITEM}>
                {schemaItems[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Only under IFC2X3, and only because it is a surprise: the schema has
            no tessellation, so every mesh goes out as boundary representation
            and the file is several times the size. Nothing is lost from it. */}
        {a.schema === 'IFC2X3' && <div className="fieldHint">{t('ifc.schemaBrepHint')}</div>}
      </div>

      <div className="ifcGroup">
        <div className="eyebrow ifcGroupHead">{t('ifc.project')}</div>
        <Attr
          id="ifcProjectName"
          label={t('ifc.projectName')}
          value={a.projectName}
          placeholder={p.defaultProjectName}
          onChange={(projectName) => p.onChange({ projectName })}
        />
        <Attr
          id="ifcProjectLongName"
          label={t('ifc.projectLongName')}
          value={a.projectLongName}
          onChange={(projectLongName) => p.onChange({ projectLongName })}
        />
        <Attr
          id="ifcProjectDescription"
          label={t('ifc.projectDescription')}
          value={a.projectDescription}
          onChange={(projectDescription) => p.onChange({ projectDescription })}
        />
        <Attr
          id="ifcProjectPhase"
          label={t('ifc.projectPhase')}
          value={a.projectPhase}
          onChange={(projectPhase) => p.onChange({ projectPhase })}
        />
      </div>

      <div className="ifcGroup">
        <div className="eyebrow ifcGroupHead">{t('ifc.site')}</div>
        <Attr
          id="ifcSiteName"
          label={t('ifc.siteName')}
          value={a.siteName}
          placeholder={DEFAULT_SITE_NAME}
          onChange={(siteName) => p.onChange({ siteName })}
        />
        <Attr
          id="ifcSiteLongName"
          label={t('ifc.siteLongName')}
          value={a.siteLongName}
          onChange={(siteLongName) => p.onChange({ siteLongName })}
        />
        <Attr
          id="ifcSiteDescription"
          label={t('ifc.siteDescription')}
          value={a.siteDescription}
          onChange={(siteDescription) => p.onChange({ siteDescription })}
        />
        <Attr
          id="ifcSiteLandTitle"
          label={t('ifc.siteLandTitle')}
          value={a.siteLandTitle}
          onChange={(siteLandTitle) => p.onChange({ siteLandTitle })}
        />
      </div>

      <div className="ifcGroup">
        <div className="eyebrow ifcGroupHead">{t('ifc.authorship')}</div>
        <Attr
          id="ifcAuthor"
          label={t('ifc.author')}
          value={a.author}
          onChange={(author) => p.onChange({ author })}
        />
        {/* Said here rather than left as a gap: the STEP header carries an
            organisation and an originating system beside the author, and
            without this line the missing two fields read as an oversight. */}
        <div className="fieldHint">{t('ifc.authorHint')}</div>
      </div>

      <div className="ifcFoot">
        <span className="fieldHint">{t('ifc.blankHint')}</span>
        {/* Disabled rather than hidden at the default, for the reason the
            presentation button is: a button that comes and goes moves whatever
            sits beside it. */}
        <button
          type="button"
          className="btn-ghost"
          disabled={isDefaultIfc(a)}
          onClick={p.onReset}
        >
          {t('ifc.reset')}
        </button>
      </div>
    </div>
  );
}
