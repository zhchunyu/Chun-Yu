import { ShieldCheck } from 'lucide-react'
import { ROLE_LABELS, ROLES } from '../../domain/campus.js'

const roleOptions = [ROLES.VISITOR, ROLES.STUDENT, ROLES.MANAGER]

export function RoleSwitcher({ role, onChange }) {
  return (
    <div className="role-switcher" aria-label="演示角色切换">
      <div className="eyebrow"><ShieldCheck size={13} /> 演示身份</div>
      <div className="role-switcher__options">
        {roleOptions.map((roleOption) => (
          <button
            className={`role-button ${role === roleOption ? 'is-active' : ''}`}
            key={roleOption}
            type="button"
            onClick={() => onChange(roleOption)}
          >
            {ROLE_LABELS[roleOption]}
          </button>
        ))}
      </div>
    </div>
  )
}
