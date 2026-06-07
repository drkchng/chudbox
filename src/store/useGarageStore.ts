import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import localforage from 'localforage'
import { CURRENCIES, convertPrice, convertDistance } from '../utils/units'
import type { CurrencyCode, DistanceUnitCode } from '../utils/units'
import type {
  Car,
  CarDetails,
  Photo,
  WishlistItem,
  Mod,
  MaintenanceRecord,
  Todo,
  Issue,
  TodoPriority,
} from '../types'

const idbStorage: StateStorage = {
  getItem: (name) => localforage.getItem<string>(name),
  setItem: (name, value) => localforage.setItem(name, value),
  removeItem: (name) => localforage.removeItem(name),
}

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const now = (): string => new Date().toISOString()

// ── Input shapes for create actions (store-generated fields omitted) ──
type PhotoInput = Pick<Photo, 'dataUrl' | 'caption'>
type WishlistInput = Omit<WishlistItem, 'id' | 'status' | 'addedAt'>
type ModInput = Omit<Mod, 'id' | 'addedAt'>
type MaintenanceInput = Omit<MaintenanceRecord, 'id' | 'createdAt'>
type IssueInput = Pick<Issue, 'title' | 'description' | 'severity'>

export interface GarageState {
  cars: Car[]

  // Theme
  themeId: string
  customAccent: string | null
  setTheme: (themeId: string) => void
  setCustomAccent: (hex: string) => void

  // Settings
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
  setCurrency: (to: CurrencyCode) => void
  setDistanceUnit: (to: DistanceUnitCode) => void

  // Cars
  addCar: (data: CarDetails) => void
  updateCar: (id: string, data: Partial<CarDetails>) => void
  deleteCar: (id: string) => void
  getCar: (id: string) => Car | undefined

  // Photos
  addPhoto: (carId: string, photo: PhotoInput) => void
  deletePhoto: (carId: string, photoId: string) => void
  setCoverPhoto: (carId: string, photoId: string) => void

  // Wishlist
  addWishlistItem: (carId: string, data: WishlistInput) => void
  updateWishlistItem: (carId: string, itemId: string, data: Partial<WishlistItem>) => void
  deleteWishlistItem: (carId: string, itemId: string) => void

  // Mods
  addMod: (carId: string, data: ModInput) => void
  updateMod: (carId: string, modId: string, data: Partial<Mod>) => void
  deleteMod: (carId: string, modId: string) => void

  // Maintenance
  addMaintenance: (carId: string, data: MaintenanceInput) => void
  updateMaintenance: (carId: string, recId: string, data: Partial<MaintenanceRecord>) => void
  deleteMaintenance: (carId: string, recId: string) => void

  // Todos
  addTodo: (carId: string, text: string, priority?: TodoPriority) => void
  toggleTodo: (carId: string, todoId: string) => void
  deleteTodo: (carId: string, todoId: string) => void
  updateTodo: (carId: string, todoId: string, data: Partial<Todo>) => void

  // Issues
  addIssue: (carId: string, data: IssueInput) => void
  updateIssue: (carId: string, issueId: string, data: Partial<Issue>) => void
  deleteIssue: (carId: string, issueId: string) => void
}

const useGarageStore = create<GarageState>()(
  persist(
    (set, get) => ({
      cars: [],

      // ── Theme ─────────────────────────────────────────
      themeId: 'garage',
      customAccent: null, // hex string when using custom color

      setTheme: (themeId) => set({ themeId, customAccent: null }),
      setCustomAccent: (hex) => set({ themeId: 'custom', customAccent: hex }),

      // ── Settings ──────────────────────────────────────
      currency: 'USD',
      distanceUnit: 'mi',

      setCurrency: (to) => set((s) => {
        const from = s.currency
        if (from === to || !CURRENCIES[to]) return {}
        return {
          currency: to,
          cars: s.cars.map((car) => ({
            ...car,
            salePrice:   convertPrice(car.salePrice, from, to),
            mods:        car.mods.map((m) => ({ ...m, cost: convertPrice(m.cost, from, to) })),
            maintenance: car.maintenance.map((r) => ({ ...r, cost: convertPrice(r.cost, from, to) })),
            wishlist:    car.wishlist.map((i) => ({ ...i, price: convertPrice(i.price, from, to) })),
          })),
        }
      }),

      setDistanceUnit: (to) => set((s) => {
        const from = s.distanceUnit
        if (from === to) return {}
        return {
          distanceUnit: to,
          cars: s.cars.map((car) => ({
            ...car,
            mileage: convertDistance(car.mileage, from, to),
            maintenance: car.maintenance.map((r) => ({
              ...r,
              mileage:        convertDistance(r.mileage, from, to),
              nextDueMileage: convertDistance(r.nextDueMileage, from, to),
            })),
          })),
        }
      }),

      // ── Cars ──────────────────────────────────────────
      addCar: (data) => set((s) => ({
        cars: [...s.cars, { ...data, id: uid(), photos: [], wishlist: [], mods: [], maintenance: [], todos: [], issues: [], createdAt: now() }],
      })),

      updateCar: (id, data) => set((s) => ({
        cars: s.cars.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })),

      deleteCar: (id) => set((s) => ({ cars: s.cars.filter((c) => c.id !== id) })),

      getCar: (id) => get().cars.find((c) => c.id === id),

      // ── Photos ────────────────────────────────────────
      addPhoto: (carId, { dataUrl, caption }) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, photos: [...c.photos, { id: uid(), dataUrl, caption, uploadedAt: now() }],
        }),
      })),

      deletePhoto: (carId, photoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, photos: c.photos.filter((p) => p.id !== photoId),
          coverPhoto: c.coverPhoto === photoId ? null : c.coverPhoto,
        }),
      })),

      setCoverPhoto: (carId, photoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : { ...c, coverPhoto: photoId }),
      })),

      // ── Wishlist ──────────────────────────────────────
      addWishlistItem: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: [...c.wishlist, { ...data, id: uid(), status: 'wanted', addedAt: now() }],
        }),
      })),

      updateWishlistItem: (carId, itemId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: c.wishlist.map((i) => i.id === itemId ? { ...i, ...data } : i),
        }),
      })),

      deleteWishlistItem: (carId, itemId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: c.wishlist.filter((i) => i.id !== itemId),
        }),
      })),

      // ── Mods ──────────────────────────────────────────
      addMod: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: [...c.mods, { ...data, id: uid(), addedAt: now() }],
        }),
      })),

      updateMod: (carId, modId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: c.mods.map((m) => m.id === modId ? { ...m, ...data } : m),
        }),
      })),

      deleteMod: (carId, modId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: c.mods.filter((m) => m.id !== modId),
        }),
      })),

      // ── Maintenance ───────────────────────────────────
      addMaintenance: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: [...c.maintenance, { ...data, id: uid(), createdAt: now() }],
        }),
      })),

      updateMaintenance: (carId, recId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: c.maintenance.map((r) => r.id === recId ? { ...r, ...data } : r),
        }),
      })),

      deleteMaintenance: (carId, recId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: c.maintenance.filter((r) => r.id !== recId),
        }),
      })),

      // ── Todos ─────────────────────────────────────────
      addTodo: (carId, text, priority = 'medium') => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: [...c.todos, { id: uid(), text, priority, done: false, createdAt: now() }],
        }),
      })),

      toggleTodo: (carId, todoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.map((t) => t.id === todoId ? { ...t, done: !t.done } : t),
        }),
      })),

      deleteTodo: (carId, todoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.filter((t) => t.id !== todoId),
        }),
      })),

      updateTodo: (carId, todoId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.map((t) => t.id === todoId ? { ...t, ...data } : t),
        }),
      })),

      // ── Issues ────────────────────────────────────────
      addIssue: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: [...c.issues, { ...data, id: uid(), status: 'open', createdAt: now() }],
        }),
      })),

      updateIssue: (carId, issueId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: c.issues.map((i) => i.id === issueId ? { ...i, ...data } : i),
        }),
      })),

      deleteIssue: (carId, issueId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: c.issues.filter((i) => i.id !== issueId),
        }),
      })),
    }),
    {
      name: 'garage-store',
      storage: createJSONStorage(() => idbStorage),
    }
  )
)

export default useGarageStore
