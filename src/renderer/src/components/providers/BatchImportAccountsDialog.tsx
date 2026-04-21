import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

interface BatchImportAccountsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string
  providerName: string
  onImport: (data: {
    providerId: string
    rawText: string
    dailyLimit?: number
  }) => Promise<void>
}

export function BatchImportAccountsDialog({
  open,
  onOpenChange,
  providerId,
  providerName,
  onImport,
}: BatchImportAccountsDialogProps) {
  const { t } = useTranslation()
  const [rawText, setRawText] = useState('')
  const [dailyLimit, setDailyLimit] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setRawText('')
      setDailyLimit('')
      setIsSubmitting(false)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!rawText.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onImport({
        providerId,
        rawText,
        dailyLimit: dailyLimit ? parseInt(dailyLimit, 10) : undefined,
      })
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('providers.batchImport')}</DialogTitle>
          <DialogDescription>
            {providerName} · {t('providers.batchImportDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batch-daily-limit">{t('providers.dailyLimitOptional')}</Label>
            <Input
              id="batch-daily-limit"
              type="number"
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
              placeholder={t('providers.dailyLimitPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-textarea">{t('providers.batchImportInput')}</Label>
            <Textarea
              id="batch-textarea"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              className="min-h-[260px]"
              placeholder={[
                'name----token',
                'email----password----token',
                'token',
              ].join('\n')}
            />
            <p className="text-xs text-muted-foreground">
              {t('providers.batchImportHelp')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !rawText.trim()}>
            {isSubmitting ? t('common.loading') : t('providers.batchImport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BatchImportAccountsDialog
