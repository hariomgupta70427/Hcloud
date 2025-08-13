interface TelegramConfig {
  botToken: string
  chatId: string
}

class TelegramService {
  private config: TelegramConfig | null = null

  constructor() {
    this.initConfig()
  }

  private initConfig() {
    const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN
    const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      this.config = { botToken, chatId }
    }
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  async sendMessage(message: string): Promise<boolean> {
    if (!this.config) {
      console.warn('Telegram service not configured')
      return false
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: this.config.chatId,
            text: message,
            parse_mode: 'HTML'
          })
        }
      )

      return response.ok
    } catch (error) {
      console.error('Failed to send Telegram message:', error)
      return false
    }
  }

  async sendFileNotification(fileName: string, fileSize: number, userName: string): Promise<boolean> {
    const message = `
📁 <b>New File Uploaded</b>
📝 <b>File:</b> ${fileName}
📊 <b>Size:</b> ${this.formatBytes(fileSize)}
👤 <b>User:</b> ${userName}
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  async sendUserRegistrationNotification(userName: string, userEmail: string): Promise<boolean> {
    const message = `
🎉 <b>New User Registered</b>
👤 <b>Name:</b> ${userName}
📧 <b>Email:</b> ${userEmail}
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  async sendStorageAlert(userName: string, storageUsed: number, storageLimit: number): Promise<boolean> {
    const percentage = (storageUsed / storageLimit) * 100
    
    const message = `
⚠️ <b>Storage Alert</b>
👤 <b>User:</b> ${userName}
📊 <b>Usage:</b> ${this.formatBytes(storageUsed)} / ${this.formatBytes(storageLimit)} (${percentage.toFixed(1)}%)
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}

export const telegramService = new TelegramService()