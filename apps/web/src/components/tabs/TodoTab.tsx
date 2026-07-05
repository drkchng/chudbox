import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, CheckSquare, Pencil, Check, X } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import ConfirmModal from '../ConfirmModal'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import ItemPhotos from '../photos/ItemPhotos'
import type { Car, Todo, TodoPriority, StatusRole } from '../../types'

// Priority → status role. Orange stays reclaimed for action/alert: high is a
// warning (status-amber), not the accent. low = neutral, medium = info.
const PRIORITY: Record<TodoPriority, { label: string; role: StatusRole }> = {
  low:    { label: 'Low',    role: 'neutral' },
  medium: { label: 'Medium', role: 'info' },
  high:   { label: 'High',   role: 'warning' },
}

interface TodoTabProps {
  car: Car
}

export default function TodoTab({ car }: TodoTabProps) {
  const addTodo    = useGarageStore((s) => s.addTodo)
  const toggleTodo = useGarageStore((s) => s.toggleTodo)
  const deleteTodo = useGarageStore((s) => s.deleteTodo)
  const updateTodo = useGarageStore((s) => s.updateTodo)
  const [text, setText]           = useState('')
  const [priority, setPriority]   = useState<TodoPriority>('medium')
  const [editId, setEditId]             = useState<string | null>(null)
  const [editText, setEditText]         = useState('')
  const [editPriority, setEditPriority] = useState<TodoPriority>('medium')
  const [confirmTodo, setConfirmTodo] = useState<Todo | null>(null)

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!text.trim()) return
    addTodo(car.id, text.trim(), priority)
    setText('')
  }

  const startEdit = (todo: Todo) => {
    setEditId(todo.id)
    setEditText(todo.text)
    setEditPriority(todo.priority)
  }
  const saveEdit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editId || !editText.trim()) return
    updateTodo(car.id, editId, { text: editText.trim(), priority: editPriority })
    setEditId(null)
  }

  // Shared inline edit card (pending + completed rows): a form so Enter saves.
  const renderEditForm = (todo: Todo) => (
    <form key={todo.id} onSubmit={saveEdit} className="card py-3 border-accent/30">
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-40">
          <label htmlFor="todo-edit-text" className="label">Task</label>
          <input id="todo-edit-text" className="input" value={editText}
            onChange={(e) => setEditText(e.target.value)} autoFocus />
        </div>
        <div className="w-28">
          <label htmlFor="todo-edit-priority" className="label">Priority</label>
          <select id="todo-edit-priority" className="input" value={editPriority}
            onChange={(e) => setEditPriority(e.target.value as TodoPriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditId(null)}>
            <X size={tokens.iconSize.sm} /> Cancel
          </Button>
          <Button type="submit" size="sm">
            <Check size={tokens.iconSize.sm} /> Save
          </Button>
        </div>
      </div>
    </form>
  )

  const order: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }
  const pending = car.todos.filter((t) => !t.done).sort((a, b) => order[a.priority] - order[b.priority])
  const done = car.todos.filter((t) => t.done)

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-subhead font-semibold text-text-primary">To-Do List</h3>
        <span className="text-meta text-text-secondary">{pending.length} pending · {done.length} done</span>
      </div>

      <form onSubmit={handleAdd} className="card mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label htmlFor="todo-text" className="label">New task</label>
          <input id="todo-text" className="input" placeholder="Replace brake pads…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="w-28">
          <label htmlFor="todo-priority" className="label">Priority</label>
          <select id="todo-priority" className="input" value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <Button type="submit" size="sm" className="shrink-0"><Plus size={tokens.iconSize.sm} /> Add</Button>
      </form>

      {car.todos.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <CheckSquare size={tokens.iconSize.xl} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p>No tasks yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((todo) => editId === todo.id ? renderEditForm(todo) : (
                // A11: checkbox + text live inside ONE <label> so the whole row
                // (a ≥44px target) toggles and the text names the control. The
                // priority badge + edit/delete sit OUTSIDE the label so they don't toggle.
                <div key={todo.id} className="card py-3">
                  <div className="flex items-center gap-3">
                    <label className="flex flex-1 items-center gap-3 cursor-pointer select-none min-w-0">
                      <input type="checkbox" checked={false} onChange={() => toggleTodo(car.id, todo.id)}
                        className="size-[18px] rounded-sm accent-accent cursor-pointer shrink-0" />
                      <span className="flex-1 min-w-0 text-body text-text-primary">{todo.text}</span>
                    </label>
                    <Badge status={PRIORITY[todo.priority].role}>{PRIORITY[todo.priority].label}</Badge>
                    <IconButton aria-label={`Edit task: ${todo.text}`} title="Edit" onClick={() => startEdit(todo)}>
                      <Pencil size={tokens.iconSize.sm} />
                    </IconButton>
                    <IconButton aria-label={`Delete task: ${todo.text}`} onClick={() => setConfirmTodo(todo)}>
                      <Trash2 size={tokens.iconSize.sm} />
                    </IconButton>
                  </div>
                  <ItemPhotos carId={car.id} source="todo" itemId={todo.id} photos={car.photos} itemLabel={todo.text || 'this task'} />
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p className="text-meta text-text-secondary uppercase tracking-wide mb-2">Completed</p>
              <div className="space-y-2">
                {done.map((todo) => editId === todo.id ? renderEditForm(todo) : (
                  <div key={todo.id} className="card-row flex items-center gap-3 opacity-60">
                    <label className="flex flex-1 items-center gap-3 cursor-pointer select-none min-w-0">
                      <input type="checkbox" checked onChange={() => toggleTodo(car.id, todo.id)}
                        className="size-[18px] rounded-sm accent-accent cursor-pointer shrink-0" />
                      <span className="flex-1 min-w-0 text-body text-text-secondary line-through">{todo.text}</span>
                    </label>
                    <IconButton aria-label={`Edit task: ${todo.text}`} title="Edit" onClick={() => startEdit(todo)}>
                      <Pencil size={tokens.iconSize.sm} />
                    </IconButton>
                    <IconButton aria-label={`Delete task: ${todo.text}`} onClick={() => setConfirmTodo(todo)}>
                      <Trash2 size={tokens.iconSize.sm} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {confirmTodo && (
        <ConfirmModal
          title="Delete task?"
          message={`"${confirmTodo.text}" will be permanently deleted.`}
          onConfirm={() => deleteTodo(car.id, confirmTodo.id)}
          onClose={() => setConfirmTodo(null)}
        />
      )}
    </div>
  )
}
