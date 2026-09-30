/**
 * components/dashboard-tabs/TemplatesTab.tsx
 * Tab for managing reusable proposal templates
 */
import StateMessage from "@/components/StateMessage";
import ConfirmDialog from "@/components/ConfirmDialog";

export interface ProposalTemplateItem {
  id: string;
  name: string;
  content: string;
}

interface Props {
  templates: ProposalTemplateItem[];
  templateName: string;
  templateContent: string;
  editingTemplateId: string | null;
  onTemplateNameChange: (value: string) => void;
  onTemplateContentChange: (value: string) => void;
  onSave: () => void;
  onEdit: (template: ProposalTemplateItem) => void;
  confirmDeleteTemplate: string | null;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export default function TemplatesTab({
  templates,
  templateName,
  templateContent,
  editingTemplateId,
  onTemplateNameChange,
  onTemplateContentChange,
  onSave,
  onEdit,
  confirmDeleteTemplate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: Props) {
  return (
    <>
      <div className="space-y-4">
        <div className="card space-y-3">
          <input
            value={templateName}
            onChange={(e) => onTemplateNameChange(e.target.value)}
            className="input-field"
            placeholder="Template name"
          />
          <textarea
            value={templateContent}
            onChange={(e) => onTemplateContentChange(e.target.value)}
            className="textarea-field"
            rows={5}
            placeholder="Template proposal content"
          />
          <button className="btn-primary text-sm" onClick={onSave}>
            {editingTemplateId ? "Update Template" : "Create Template"}
          </button>
        </div>
        {templates.length === 0 ? (
          <StateMessage
            type="empty"
            title="No proposal templates"
            description="Create a template to speed up your proposals"
            ctaLabel="Create Template"
            onCta={onSave}
          />
        ) : (
          templates.map((template) => (
            <div key={template.id} className="card">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-amber-100 font-medium">{template.name}</p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs px-3 py-1.5"
                    onClick={() => onEdit(template)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-secondary text-xs px-3 py-1.5"
                    onClick={() => onRequestDelete(template.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-sm text-amber-700 whitespace-pre-wrap">
                {template.content}
              </p>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteTemplate !== null}
        title="Delete Proposal Template"
        description="Are you sure you want to delete this proposal template? This action cannot be undone."
        confirmLabel="Yes, Delete"
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}
