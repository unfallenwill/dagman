import * as readline from 'readline'

export async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(`${message} (y/N): `, (answer: string) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}
