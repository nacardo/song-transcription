import { useState } from 'react'
import './App.css'
import { Library } from './Library'
import { Paste } from './Paste'
import { Practice } from './Practice'
import {
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  type Song,
} from './storage'

type View =
  | { name: 'library' }
  | { name: 'paste'; editingId?: string }
  | { name: 'practice'; songId: string }

export default function App() {
  const [songs, setSongs] = useState<Song[]>(() => listSongs())
  const [view, setView] = useState<View>(() =>
    listSongs().length === 0 ? { name: 'paste' } : { name: 'library' },
  )

  function refresh() {
    setSongs(listSongs())
  }

  function handleSave(title: string, artist: string, lyrics: string) {
    const editingId =
      view.name === 'paste' ? view.editingId : undefined
    const saved = saveSong({ id: editingId, title, artist, lyrics })
    refresh()
    setView({ name: 'practice', songId: saved.id })
  }

  function handleDelete(id: string) {
    deleteSong(id)
    const remaining = listSongs()
    setSongs(remaining)
    if (remaining.length === 0) setView({ name: 'paste' })
  }

  if (view.name === 'library') {
    return (
      <Library
        songs={songs}
        onOpen={(id) => setView({ name: 'practice', songId: id })}
        onEdit={(id) => setView({ name: 'paste', editingId: id })}
        onDelete={handleDelete}
        onNew={() => setView({ name: 'paste' })}
      />
    )
  }

  if (view.name === 'paste') {
    const initial = view.editingId ? getSong(view.editingId) : undefined
    return (
      <Paste
        initial={initial}
        canCancel={songs.length > 0}
        onSave={handleSave}
        onCancel={() => setView({ name: 'library' })}
      />
    )
  }

  const song = getSong(view.songId)
  if (!song) {
    setView({ name: 'library' })
    return null
  }
  return (
    <Practice
      song={song}
      onBack={() => setView({ name: 'library' })}
      onEdit={() => setView({ name: 'paste', editingId: song.id })}
    />
  )
}
