import { Html, Head, Body, Container, Heading, Text, Button, Hr, Section } from '@react-email/components';
import { emailVerificationCopy, type EmailVerificationLocale } from './email-verification.copy.js';

interface EmailVerificationEmailProps {
  verificationLink: string;
  locale: EmailVerificationLocale;
}

export function EmailVerificationEmail({
  verificationLink,
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
            <Button
              href={verificationLink}
              style={{
                backgroundColor: '#6C3CE0',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
              }}
            >
              {copy.verifyCta}
            </Button>
          </Section>
          <Hr />
          <Text style={{ fontSize: '12px', color: '#6B6B7B' }}>
            Grabit account security notice
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
