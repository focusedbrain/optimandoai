import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

function Demo() {
  const [ok, setOk] = useState(false)
  return (
    <div>
      <button onClick={() => setOk(true)}>Start</button>
      {ok && <p>Läuft</p>}
    </div>
  )
}

it('klickt Button und zeigt "Läuft"', async () => {
  render(<Demo />)
  await userEvent.click(screen.getByRole('button', { name: /start/i }))
  expect(screen.getByText(/läuft/i)).toBeInTheDocument()
})
