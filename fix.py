content = open('contracts/marketpay-contract/src/lib.rs', 'r').read()
open('contracts/marketpay-contract/src/lib.rs', 'w').write(content.replace('CreateEscrowParams {', '&CreateEscrowParams {'))
