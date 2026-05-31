import { useRef, useState } from 'react'
import { Upload, Star, Trash2, X } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'

export default function PhotosTab({ car }) {
  const addPhoto = useGarageStore((s) => s.addPhoto)
  const deletePhoto = useGarageStore((s) => s.deletePhoto)
  const setCoverPhoto = useGarageStore((s) => s.setCoverPhoto)
  const fileRef = useRef()
  const [caption, setCaption] = useState('')
  const [preview, setPreview] = useState(null)
  const [lightbox, setLightbox] = useState(null)

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPreview(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleAdd = () => {
    if (!preview) return
    addPhoto(car.id, { dataUrl: preview, caption })
    setPreview(null)
    setCaption('')
  }

  return (
    <div>
      {/* Upload area */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-white mb-4">Upload Photo</h3>
        {preview ? (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden h-48 bg-surface-2">
              <img src={preview} alt="preview" className="w-full h-full object-contain" />
              <button onClick={() => setPreview(null)} className="absolute top-2 right-2 bg-black/60 rounded-full p-1 text-white hover:text-red-400">
                <X size={14} />
              </button>
            </div>
            <input className="input" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="btn-outline">Cancel</button>
              <button onClick={handleAdd} className="btn-primary">Save Photo</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current.click()}
            className="w-full h-32 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-accent/50 hover:text-accent transition-colors cursor-pointer"
          >
            <Upload size={24} />
            <span className="text-sm">Click to upload a photo</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>

      {/* Photo grid */}
      {car.photos.length === 0 ? (
        <p className="text-center text-gray-600 py-10">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {car.photos.map((photo) => (
            <div key={photo.id} className="relative group rounded-xl overflow-hidden bg-surface-2 aspect-square cursor-pointer"
              onClick={() => setLightbox(photo)}
            >
              <img src={photo.dataUrl} alt={photo.caption} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              {car.coverPhoto === photo.id && (
                <span className="absolute top-2 left-2 badge bg-accent/90 text-white text-xs"><Star size={10} className="mr-1" fill="currentColor" />Cover</span>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                <button onClick={(e) => { e.stopPropagation(); setCoverPhoto(car.id, photo.id) }}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-accent text-white transition-colors" title="Set as cover">
                  <Star size={14} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); deletePhoto(car.id, photo.id) }}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-red-600 text-white transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
              {photo.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <p className="text-xs text-white truncate">{photo.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white hover:text-gray-300"><X size={24} /></button>
          <img src={lightbox.dataUrl} alt={lightbox.caption} className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          {lightbox.caption && <p className="absolute bottom-6 text-white text-sm">{lightbox.caption}</p>}
        </div>
      )}
    </div>
  )
}
