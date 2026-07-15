import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Pencil,
  RefreshCcw,
  ShieldCheck,
  Timer,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ComplianceStatus,
  SubjectReleaseInput,
} from "../types";

type Text = (value: string) => string;

export type ConsentRetentionPanelProps = {
  status: ComplianceStatus | null;
  busy: boolean;
  people: string[];
  uiText: Text;
  refresh(): void | Promise<void>;
  acknowledgeDisclosure(): void | Promise<void>;
  saveRelease(value: SubjectReleaseInput): void | Promise<void>;
  deleteSubject(personName: string): void | Promise<void>;
  exportPolicy(): void | Promise<void>;
  recordPublication(publicUrl: string, approvedBy: string): void | Promise<void>;
  enforceRetention(): void | Promise<void>;
};

const DEFAULT_PURPOSE = "Find and review family archive photos in this local workspace.";

function dateLabel(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

export function ConsentRetentionPanel({
  status,
  busy,
  people,
  uiText,
  refresh,
  acknowledgeDisclosure,
  saveRelease,
  deleteSubject,
  exportPolicy,
  recordPublication,
  enforceRetention,
}: ConsentRetentionPanelProps) {
  const subjectOptions = useMemo(() => {
    const names = new Set(people.map((value) => value.trim()).filter(Boolean));
    for (const record of status?.subjects.records ?? []) names.add(record.personName);
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [people, status?.subjects.records]);
  const defaultTerm = status?.jurisdiction.defaultCollectionTermDays ?? 365;
  const maximumTerm = status?.jurisdiction.biometricMaxRetentionDays || 3650;
  const [personName, setPersonName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("self");
  const [specificPurpose, setSpecificPurpose] = useState(DEFAULT_PURPOSE);
  const [collectionTermDays, setCollectionTermDays] = useState(defaultTerm);
  const [lawfulBasis, setLawfulBasis] = useState("informed-written-release");
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [signatureAccepted, setSignatureAccepted] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [approvedBy, setApprovedBy] = useState("");

  useEffect(() => {
    setCollectionTermDays(defaultTerm);
  }, [defaultTerm, status?.jurisdiction.id]);

  useEffect(() => {
    if (!personName && subjectOptions.length) setPersonName(subjectOptions[0]);
  }, [personName, subjectOptions]);

  useEffect(() => {
    const publication = status?.retentionPolicy.publication;
    if (publication?.current) {
      setPublicUrl(publication.publicUrl);
      setApprovedBy(publication.approvedBy);
    }
  }, [status?.retentionPolicy.publication]);

  function editRecord(name: string) {
    const record = status?.subjects.records.find((item) => item.personName === name);
    if (!record) return;
    setPersonName(record.personName);
    setSignerName(record.signerName);
    setSignerRole(record.signerRole || "self");
    setSpecificPurpose(record.specificPurpose || DEFAULT_PURPOSE);
    setCollectionTermDays(record.collectionTermDays || defaultTerm);
    setLawfulBasis(record.lawfulBasis || "informed-written-release");
    setNoticeAccepted(false);
    setSignatureAccepted(false);
    setDisclosureAccepted(false);
  }

  const releaseReady = Boolean(
    personName.trim()
    && signerName.trim()
    && specificPurpose.trim()
    && lawfulBasis.trim()
    && collectionTermDays >= 1
    && collectionTermDays <= maximumTerm
    && noticeAccepted
    && signatureAccepted
    && disclosureAccepted
  );
  const publication = status?.retentionPolicy.publication;
  const due = status?.startupEnforcement;

  return (
    <section className="compliance-governance" aria-labelledby="compliance-governance-title">
      <div className="compliance-section-heading">
        <div>
          <h3 id="compliance-governance-title">{uiText("Consent, disclosure, and retention")}</h3>
          <small>{uiText("Written releases and policy evidence are encrypted inside this app folder.")}</small>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          title={uiText("Refresh compliance status")}
          aria-label={uiText("Refresh compliance status")}
        >
          <RefreshCcw size={17} />
        </button>
      </div>

      {status ? (
        <div className="compliance-status-grid" aria-label={uiText("Compliance evidence status")}>
          <span>
            <small>{uiText("Processing")}</small>
            <strong className={status.processingAllowed ? "status accepted" : "status uncertain"}>
              {status.processingAllowed ? uiText("Allowed") : uiText("Paused")}
            </strong>
          </span>
          <span>
            <small>{uiText("Evidence")}</small>
            <strong className={status.evidenceReady ? "status accepted" : "status uncertain"}>
              {status.evidenceReady ? uiText("Current") : uiText("Action required")}
            </strong>
          </span>
          <span>
            <small>{uiText("Stored subject coverage")}</small>
            <strong>{status.subjects.covered}/{status.subjects.biometric}</strong>
          </span>
          <span>
            <small>{uiText("Expired")}</small>
            <strong>{status.subjects.expired}</strong>
          </span>
        </div>
      ) : (
        <p className="compact">{uiText("Load the current disclosure, release, and retention evidence for this app folder.")}</p>
      )}

      {status?.jurisdiction.perSubjectConsent && status.subjects.missing > 0 && (
        <div className="compliance-missing-release" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            <strong>{uiText("Stored subjects without a current release")}: {status.subjects.missing}</strong>
            <small>{status.subjects.missingNames.join(", ")}</small>
            <small>{uiText("Add or renew a written release before processing these subjects.")}</small>
          </span>
        </div>
      )}

      {status && (
        <section className="compliance-band" aria-labelledby="ai-disclosure-title">
          <div className="compliance-band-title">
            <ShieldCheck size={18} />
            <div>
              <h4 id="ai-disclosure-title">{uiText(status.aiDisclosure.notice.title)}</h4>
              <small>
                {status.aiDisclosure.acknowledged
                  ? `${uiText("Acknowledged")} ${dateLabel(status.aiDisclosure.acknowledgedAt)}`
                  : uiText("Acknowledgement required before strict-presets permit processing.")}
              </small>
            </div>
            {status.aiDisclosure.acknowledged
              ? <CheckCircle2 className="compliance-ok-icon" size={20} aria-hidden="true" />
              : <AlertTriangle className="compliance-warn-icon" size={20} aria-hidden="true" />}
          </div>
          <p>{uiText(status.aiDisclosure.notice.summary)}</p>
          <p>{uiText(status.aiDisclosure.notice.decisionBoundary)}</p>
          <p>{uiText(status.aiDisclosure.notice.dataFlow)}</p>
          <p>{uiText(status.aiDisclosure.notice.generatedContent)}</p>
          {!status.aiDisclosure.acknowledged && (
            <button className="secondary" type="button" onClick={() => void acknowledgeDisclosure()} disabled={busy}>
              <ShieldCheck size={17} />
              <span>{uiText("Review and acknowledge")}</span>
            </button>
          )}
        </section>
      )}

      <section className="compliance-band" aria-labelledby="written-release-title">
        <div className="compliance-band-title">
          <UserRound size={18} />
          <div>
            <h4 id="written-release-title">{uiText("Subject written release")}</h4>
            <small>{uiText("Record the signer, specific purpose, collection term, notice, and electronic signature.")}</small>
          </div>
        </div>
        <div className="release-form-grid">
          <label>
            <span>{uiText("Subject")}</span>
            <input
              value={personName}
              aria-label={uiText("Subject")}
              onChange={(event) => setPersonName(event.currentTarget.value)}
              list="compliance-subject-options"
              maxLength={200}
              placeholder={uiText("Person name")}
            />
            <datalist id="compliance-subject-options">
              {subjectOptions.map((name) => <option value={name} key={name} />)}
            </datalist>
          </label>
          <label>
            <span>{uiText("Signer")}</span>
            <input aria-label={uiText("Signer")} value={signerName} onChange={(event) => setSignerName(event.currentTarget.value)} maxLength={200} />
          </label>
          <label>
            <span>{uiText("Signer role")}</span>
            <select aria-label={uiText("Signer role")} value={signerRole} onChange={(event) => setSignerRole(event.currentTarget.value)}>
              <option value="self">{uiText("Self")}</option>
              <option value="parent-guardian">{uiText("Parent or guardian")}</option>
              <option value="authorized-representative">{uiText("Authorized representative")}</option>
              <option value="operator-attestation">{uiText("Operator attestation")}</option>
            </select>
          </label>
          <label>
            <span>{uiText("Collection term")}</span>
            <span className="release-term-input">
              <input
                type="number"
                aria-label={uiText("Collection term")}
                min={1}
                max={maximumTerm}
                value={collectionTermDays}
                onChange={(event) => setCollectionTermDays(Number(event.currentTarget.value))}
              />
              <small>{uiText("days")}</small>
            </span>
          </label>
          <label className="release-form-wide">
            <span>{uiText("Specific purpose")}</span>
            <textarea aria-label={uiText("Specific purpose")} value={specificPurpose} onChange={(event) => setSpecificPurpose(event.currentTarget.value)} maxLength={1200} />
          </label>
          <label className="release-form-wide">
            <span>{uiText("Lawful basis")}</span>
            <input aria-label={uiText("Lawful basis")} value={lawfulBasis} onChange={(event) => setLawfulBasis(event.currentTarget.value)} maxLength={200} />
          </label>
        </div>
        <div className="release-attestations">
          <label>
            <input type="checkbox" checked={noticeAccepted} onChange={(event) => setNoticeAccepted(event.currentTarget.checked)} />
            <span>{uiText("The signer received written notice of collection, purpose, storage, and term.")}</span>
          </label>
          <label>
            <input type="checkbox" checked={disclosureAccepted} onChange={(event) => setDisclosureAccepted(event.currentTarget.checked)} />
            <span>{uiText("The signer reviewed the current AI and biometric processing notice.")}</span>
          </label>
          <label>
            <input type="checkbox" checked={signatureAccepted} onChange={(event) => setSignatureAccepted(event.currentTarget.checked)} />
            <span>{uiText("The signer adopts this record as an electronic written release.")}</span>
          </label>
        </div>
        <button
          className="primary"
          type="button"
          disabled={busy || !releaseReady}
          onClick={() => void saveRelease({
            personName: personName.trim(),
            signerName: signerName.trim(),
            signerRole,
            specificPurpose: specificPurpose.trim(),
            collectionTermDays,
            lawfulBasis: lawfulBasis.trim(),
            writtenNoticeAcknowledged: noticeAccepted,
            electronicSignatureAccepted: signatureAccepted,
            aiDisclosureAcknowledged: disclosureAccepted,
          })}
        >
          <ShieldCheck size={17} />
          <span>{uiText("Save written release")}</span>
        </button>

        {!!status?.subjects.records.length && (
          <div className="release-records" role="list" aria-label={uiText("Subject release records")}>
            {status.subjects.records.map((record) => (
              <div className="release-record-row" role="listitem" key={record.releaseId || record.personName}>
                <span>
                  <strong>{record.personName}</strong>
                  <small>
                    {record.expired
                      ? uiText("Expired")
                      : record.complete
                        ? `${uiText("Valid through")} ${dateLabel(record.expiresAt)}`
                        : uiText("Incomplete")}
                  </small>
                </span>
                <span className="release-record-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => editRecord(record.personName)}
                    disabled={busy}
                    title={uiText("Edit release")}
                    aria-label={`${uiText("Edit release")}: ${record.personName}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => void deleteSubject(record.personName)}
                    disabled={busy}
                    title={uiText("Revoke release and delete subject data")}
                    aria-label={`${uiText("Revoke release and delete subject data")}: ${record.personName}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {status && (
        <section className="compliance-band" aria-labelledby="retention-policy-title">
          <div className="compliance-band-title">
            <Timer size={18} />
            <div>
              <h4 id="retention-policy-title">{uiText(status.retentionPolicy.title)}</h4>
              <small>
                {status.retentionPolicy.policyVersion} - {status.retentionPolicy.policyHash.slice(0, 12)}
              </small>
            </div>
            {publication?.current
              ? <CheckCircle2 className="compliance-ok-icon" size={20} aria-hidden="true" />
              : <AlertTriangle className="compliance-warn-icon" size={20} aria-hidden="true" />}
          </div>
          <div className="retention-schedule-grid">
            <span><small>{uiText("Reviewed matches")}</small><strong>{status.retentionPolicy.schedule.reviewedMatches.retainDays} {uiText("days")}</strong></span>
            <span><small>{uiText("Pending matches")}</small><strong>{status.retentionPolicy.schedule.pendingMatches.retainDays} {uiText("days")}</strong></span>
            <span><small>{uiText("Audit evidence")}</small><strong>{status.retentionPolicy.schedule.auditEvidence.retainDays} {uiText("days")}</strong></span>
            <span><small>{uiText("Enforcement")}</small><strong>{status.retentionPolicy.enforcementEnabled ? uiText("Automatic") : uiText("Manual")}</strong></span>
          </div>
          <p>{uiText(status.retentionPolicy.destructionMethod)}</p>
          <small>{uiText(status.retentionPolicy.disclaimer)}</small>
          <div className="button-row">
            <button className="secondary" type="button" onClick={() => void exportPolicy()} disabled={busy}>
              <FileText size={17} />
              <span>{uiText("Export publication files")}</span>
            </button>
            <button className="secondary" type="button" onClick={() => void enforceRetention()} disabled={busy || !status.retentionPolicy.enforcementEnabled}>
              <Timer size={17} />
              <span>{uiText("Enforce now")}</span>
            </button>
          </div>
          {due && (
            <small>
              {uiText("Last startup enforcement")}: {due.expiredSubjectsDeleted} {uiText("expired subjects")}, {due.reviewedCandidatesDeleted + due.pendingCandidatesDeleted} {uiText("match rows")}.
            </small>
          )}
          <div className="policy-publication-form">
            <div className="policy-publication-status">
              <ExternalLink size={17} />
              <span>
                <strong>
                  {publication?.current
                    ? uiText("Current public policy recorded")
                    : status.retentionPolicy.publicPolicyRequired
                      ? uiText("Public policy evidence required")
                      : uiText("Public policy evidence optional")}
                </strong>
                <small>
                  {publication?.current
                    ? `${publication.publicUrl} - ${dateLabel(publication.publishedAt)}`
                    : uiText("Export, obtain legal approval, publish over HTTPS, then record the exact public location.")}
                </small>
              </span>
            </div>
            <label>
              <span>{uiText("Public policy URL")}</span>
              <input
                type="url"
                aria-label={uiText("Public policy URL")}
                inputMode="url"
                value={publicUrl}
                onChange={(event) => setPublicUrl(event.currentTarget.value)}
                placeholder="https://example.org/privacy/biometric-retention"
                maxLength={1200}
              />
            </label>
            <label>
              <span>{uiText("Approved by")}</span>
              <input aria-label={uiText("Approved by")} value={approvedBy} onChange={(event) => setApprovedBy(event.currentTarget.value)} maxLength={200} />
            </label>
            <button
              className="secondary"
              type="button"
              onClick={() => void recordPublication(publicUrl.trim(), approvedBy.trim())}
              disabled={busy || !publicUrl.trim() || !approvedBy.trim()}
            >
              <ExternalLink size={17} />
              <span>{uiText("Record publication")}</span>
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
