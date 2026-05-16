import { Html, Head, Body, Container, Heading, Text, Hr, Section } from '@react-email/components';
import { emailVerificationCopy, type EmailVerificationLocale } from './email-verification.copy.js';

interface EmailVerificationEmailProps {
  verificationCode: string;
  locale: EmailVerificationLocale;
}

export function EmailVerificationEmail({
  verificationCode,
  locale,
}: EmailVerificationEmailProps) {
  const copy = emailVerificationCopy[locale];

  return (
    <Html lang={locale}>
      <Head />
      <Body style={{ backgroundColor: '#f5f5f7', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: '560px' }}>
          <Heading style={{ fontSize: '20px', color: '#1A1A2E' }}>{copy.subject}</Heading>
          <Text style={{ fontSize: '14px', color: '#4A4A5E' }}>{copy.bodyIntro}</Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Text
              style={{
                display: 'inline-block',
                margin: '0',
                padding: '14px 22px',
                border: '1px solid #D6D1F5',
                borderRadius: '8px',
                backgroundColor: '#F4F0FF',
                color: '#1A1A2E',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '28px',
                fontWeight: 700,
                letterSpacing: '0',
              }}
            >
              {verificationCode}
            </Text>
          </Section>
          <Text style={{ fontSize: '13px', color: '#6B6B7B' }}>{copy.codeHelp}</Text>
          <Hr />
          <Text style={{ fontSize: '12px', color: '#6B6B7B' }}>
            Grabit account security notice
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
