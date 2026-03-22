import { PrismaClient } from '../src/generated/prisma/index.js'

const prisma = new PrismaClient({})

async function main() {
  // Clean up existing data (optional, useful for idempotency)
  await prisma.agentTrace.deleteMany()
  await prisma.lead.deleteMany()
  await prisma.microTask.deleteMany()

  // Create mock Leads
  const lead1 = await prisma.lead.create({
    data: {
      entreprise: 'Acme Corp',
      contact: 'john.doe@acmecorp.com',
      intent_score: 85.5,
      status: 'qualified',
      traces: {
        create: [
          {
            reasoning: 'Found recent funding news and matching job offers.',
            data_source: 'LinkedIn & Crunchbase',
            confidence_score: 90.0,
          },
        ],
      },
    },
  })

  const lead2 = await prisma.lead.create({
    data: {
      entreprise: 'Global Tech',
      contact: 'jane.smith@globaltech.io',
      intent_score: 42.0,
      status: 'pending',
      traces: {
        create: [
          {
            reasoning: 'Company profile matches ICP, but no clear recent signals.',
            data_source: 'Company Website',
            confidence_score: 65.0,
          },
        ],
      },
    },
  })

  // Create mock MicroTasks
  await prisma.microTask.createMany({
    data: [
      { step: 'extraction', status: 'success' },
      { step: 'validation', status: 'pending' },
      { step: 'drafting', status: 'failed' },
    ],
  })

  console.log('Seeded successfully:')
  console.log('Leads created:', [lead1.entreprise, lead2.entreprise])
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
